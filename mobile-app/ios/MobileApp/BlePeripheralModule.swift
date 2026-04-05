import Foundation
import CoreBluetooth
import React

@objc(BlePeripheralModule)
class BlePeripheralModule: RCTEventEmitter {

  private var peripheralManager: CBPeripheralManager?
  private var isAdvertising = false
  private var hasListeners = false

  private var statusCharacteristic: CBMutableCharacteristic?
  private var subscribedCentrals: [CBCentral] = []

  private var pendingChallenge: Data?
  private var challengeTimer: Timer?

  private let serviceUUID = CBUUID(string: "FFFD")
  private let controlPointUUID = CBUUID(string: "F1D0FFF1-DEAA-ECEE-B42F-C9BA7ED623BB")
  private let statusUUID = CBUUID(string: "F1D0FFF2-DEAA-ECEE-B42F-C9BA7ED623BB")
  private let controlPointLengthUUID = CBUUID(string: "F1D0FFF3-DEAA-ECEE-B42F-C9BA7ED623BB")
  private let serviceRevisionUUID = CBUUID(string: "F1D0FFF4-DEAA-ECEE-B42F-C9BA7ED623BB")
  private let publicKeyUUID = CBUUID(string: "F1D0FFF5-DEAA-ECEE-B42F-C9BA7ED623BB")

  private static let STATUS_APPROVED: UInt8 = 0x00
  private static let STATUS_DENIED: UInt8 = 0x01
  private static let STATUS_TIMEOUT: UInt8 = 0x02
  private static let CHALLENGE_TIMEOUT: TimeInterval = 30

  private static let WIRE_MODE_TAP: UInt8 = 0x00
  private static let WIRE_MODE_AUTO: UInt8 = 0x01

  override init() {
    super.init()
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["BlePeripheralStateChanged", "ChallengeReceived", "ChallengeDismissed"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  // MARK: - JS-callable methods

  @objc func initialize(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    peripheralManager = CBPeripheralManager(delegate: self, queue: nil)

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        _ = try SecureEnclaveManager.shared.getOrCreateKeyPair()
        NSLog("[BlePeripheral] Key ready")
      } catch {
        NSLog("[BlePeripheral] Key pre-generation failed: %@", error.localizedDescription)
      }
    }

    resolve(nil)
  }

  @objc func startAdvertising(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let pm = peripheralManager else {
      reject("NOT_INITIALIZED", "Call initialize() first", nil)
      return
    }
    guard pm.state == .poweredOn else {
      reject("NOT_POWERED_ON", "Bluetooth is not powered on (state: \(stateString(pm.state)))", nil)
      return
    }

    pm.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
      CBAdvertisementDataLocalNameKey: "FIDO2-Key",
    ])
    isAdvertising = true
    resolve(nil)
  }

  @objc func stopAdvertising(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    peripheralManager?.stopAdvertising()
    isAdvertising = false
    resolve(nil)
  }

  @objc func getState(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let pm = peripheralManager else {
      resolve("unknown")
      return
    }
    resolve(stateString(pm.state))
  }

  @objc func approveChallenge(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let challenge = pendingChallenge else {
      reject("NO_CHALLENGE", "No pending challenge to approve", nil)
      return
    }

    cancelChallengeTimer()

    do {
      let signature = try SecureEnclaveManager.shared.sign(challenge: challenge)
      var response = Data([BlePeripheralModule.STATUS_APPROVED])
      response.append(signature)
      sendStatusNotification(response)
      NSLog("[BlePeripheral] Challenge approved, signature %d bytes", signature.count)
      clearPendingChallenge()
      resolve(nil)
    } catch {
      NSLog("[BlePeripheral] Signing failed: %@", error.localizedDescription)
      reject("SIGNING_FAILED", error.localizedDescription, error)
    }
  }

  @objc func denyChallenge(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    cancelChallengeTimer()
    sendStatusNotification(Data([BlePeripheralModule.STATUS_DENIED]))
    NSLog("[BlePeripheral] Challenge denied by user")
    clearPendingChallenge()
    resolve(nil)
  }

  @objc func getPublicKey(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      let data = try SecureEnclaveManager.shared.publicKeyData()
      resolve(data.base64EncodedString())
    } catch {
      reject("KEY_ERROR", error.localizedDescription, error)
    }
  }

  // MARK: - Challenge lifecycle

  private func handleIncomingChallenge(_ data: Data) {
    guard data.count >= 2 else {
      NSLog("[BlePeripheral] Challenge too short: %d bytes", data.count)
      return
    }

    let modeByte = data[0]
    let challenge = data.subdata(in: 1..<data.count)

    cancelChallengeTimer()
    clearPendingChallenge()
    pendingChallenge = challenge

    NSLog("[BlePeripheral] Challenge received: %d bytes, mode: 0x%02x", challenge.count, modeByte)

    if modeByte == BlePeripheralModule.WIRE_MODE_AUTO {
      autoApproveChallenge()
      return
    }

    if hasListeners {
      sendEvent(withName: "ChallengeReceived", body: [
        "value": challenge.base64EncodedString(),
        "size": challenge.count,
      ])
    }

    DispatchQueue.main.async { [weak self] in
      self?.challengeTimer = Timer.scheduledTimer(
        withTimeInterval: BlePeripheralModule.CHALLENGE_TIMEOUT,
        repeats: false
      ) { [weak self] _ in
        self?.handleChallengeTimeout()
      }
    }
  }

  private func autoApproveChallenge() {
    guard let challenge = pendingChallenge else { return }
    do {
      let signature = try SecureEnclaveManager.shared.sign(challenge: challenge)
      var response = Data([BlePeripheralModule.STATUS_APPROVED])
      response.append(signature)
      sendStatusNotification(response)
      NSLog("[BlePeripheral] Auto-approved, signature %d bytes", signature.count)
      clearPendingChallenge()
    } catch {
      let msg = error.localizedDescription
      NSLog("[BlePeripheral] Auto-approve signing failed: %@", msg)
      var response = Data([0x03])
      response.append(msg.data(using: .utf8) ?? Data())
      sendStatusNotification(response)
      clearPendingChallenge()
    }
  }

  private func handleChallengeTimeout() {
    guard pendingChallenge != nil else { return }
    NSLog("[BlePeripheral] Challenge timed out")
    sendStatusNotification(Data([BlePeripheralModule.STATUS_TIMEOUT]))
    clearPendingChallenge()
    if hasListeners {
      sendEvent(withName: "ChallengeDismissed", body: ["reason": "timeout"])
    }
  }

  private func cancelChallengeTimer() {
    challengeTimer?.invalidate()
    challengeTimer = nil
  }

  private func clearPendingChallenge() {
    pendingChallenge = nil
  }

  // MARK: - BLE notification

  private func sendStatusNotification(_ data: Data) {
    guard let char = statusCharacteristic, let pm = peripheralManager else {
      NSLog("[BlePeripheral] Cannot send notification: no characteristic or manager")
      return
    }
    let sent = pm.updateValue(
      data,
      for: char,
      onSubscribedCentrals: subscribedCentrals.isEmpty ? nil : subscribedCentrals
    )
    if !sent {
      NSLog("[BlePeripheral] updateValue returned false — queue full, retrying")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
        self?.sendStatusNotification(data)
      }
    }
  }

  // MARK: - GATT service construction

  private func buildAndAddService() {
    let controlPoint = CBMutableCharacteristic(
      type: controlPointUUID,
      properties: [.write],
      value: nil,
      permissions: [.writeable]
    )

    let status = CBMutableCharacteristic(
      type: statusUUID,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )
    statusCharacteristic = status

    var lengthBytes: [UInt8] = [0x02, 0x00]
    let controlPointLength = CBMutableCharacteristic(
      type: controlPointLengthUUID,
      properties: [.read],
      value: Data(bytes: &lengthBytes, count: 2),
      permissions: [.readable]
    )

    let serviceRevision = CBMutableCharacteristic(
      type: serviceRevisionUUID,
      properties: [.read],
      value: "1.0".data(using: .utf8),
      permissions: [.readable]
    )

    let publicKey = CBMutableCharacteristic(
      type: publicKeyUUID,
      properties: [.read],
      value: nil,
      permissions: [.readable]
    )

    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [controlPoint, status, controlPointLength, serviceRevision, publicKey]
    peripheralManager?.add(service)
  }

  private func stateString(_ state: CBManagerState) -> String {
    switch state {
    case .unknown:      return "unknown"
    case .resetting:    return "resetting"
    case .unsupported:  return "unsupported"
    case .unauthorized: return "unauthorized"
    case .poweredOff:   return "poweredOff"
    case .poweredOn:    return "poweredOn"
    @unknown default:   return "unknown"
    }
  }
}

// MARK: - CBPeripheralManagerDelegate

extension BlePeripheralModule: CBPeripheralManagerDelegate {

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    let state = stateString(peripheral.state)
    NSLog("[BlePeripheral] State: %@", state)
    if hasListeners {
      sendEvent(withName: "BlePeripheralStateChanged", body: state)
    }
    if peripheral.state == .poweredOn {
      buildAndAddService()
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error = error {
      NSLog("[BlePeripheral] Service add failed: %@", error.localizedDescription)
      return
    }
    NSLog("[BlePeripheral] Service %@ added — auto-starting advertising", service.uuid.uuidString)
    peripheral.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
      CBAdvertisementDataLocalNameKey: "FIDO2-Key",
    ])
    isAdvertising = true
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    if let error = error {
      NSLog("[BlePeripheral] Advertising failed: %@", error.localizedDescription)
    } else {
      NSLog("[BlePeripheral] Advertising started")
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    if characteristic.uuid == statusUUID {
      if !subscribedCentrals.contains(where: { $0.identifier == central.identifier }) {
        subscribedCentrals.append(central)
      }
      NSLog("[BlePeripheral] Central subscribed to u2fStatus")
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    if characteristic.uuid == statusUUID {
      subscribedCentrals.removeAll { $0.identifier == central.identifier }
      NSLog("[BlePeripheral] Central unsubscribed from u2fStatus")
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests {
      if request.characteristic.uuid == controlPointUUID, let value = request.value {
        handleIncomingChallenge(value)
      }
      peripheral.respond(to: request, withResult: .success)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    if request.characteristic.uuid == publicKeyUUID {
      do {
        let keyData = try SecureEnclaveManager.shared.publicKeyData()
        if request.offset > keyData.count {
          peripheral.respond(to: request, withResult: .invalidOffset)
          return
        }
        request.value = keyData.subdata(in: request.offset..<keyData.count)
        peripheral.respond(to: request, withResult: .success)
      } catch {
        NSLog("[BlePeripheral] Public key read failed: %@", error.localizedDescription)
        peripheral.respond(to: request, withResult: .unlikelyError)
      }
      return
    }

    if let value = request.characteristic.value {
      request.value = value.subdata(in: request.offset..<value.count)
      peripheral.respond(to: request, withResult: .success)
    } else {
      peripheral.respond(to: request, withResult: .attributeNotFound)
    }
  }
}
