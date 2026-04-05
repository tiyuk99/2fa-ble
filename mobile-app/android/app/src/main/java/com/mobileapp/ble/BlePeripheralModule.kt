package com.mobileapp.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class BlePeripheralModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "BlePeripheral"
    private val SERVICE_UUID = UUID.fromString("0000FFFD-0000-1000-8000-00805F9B34FB")
    private val CONTROL_POINT_UUID = UUID.fromString("F1D0FFF1-DEAA-ECEE-B42F-C9BA7ED623BB")
    private val STATUS_UUID = UUID.fromString("F1D0FFF2-DEAA-ECEE-B42F-C9BA7ED623BB")
    private val CONTROL_POINT_LENGTH_UUID = UUID.fromString("F1D0FFF3-DEAA-ECEE-B42F-C9BA7ED623BB")
    private val SERVICE_REVISION_UUID = UUID.fromString("F1D0FFF4-DEAA-ECEE-B42F-C9BA7ED623BB")
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")
  }

  private var bluetoothManager: BluetoothManager? = null
  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var isAdvertising = false

  override fun getName(): String = "BlePeripheralModule"

  @ReactMethod
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
    // Required for NativeEventEmitter
  }

  @ReactMethod
  fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) {
    // Required for NativeEventEmitter
  }

  @ReactMethod
  fun initialize(promise: Promise) {
    bluetoothManager =
      reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    if (bluetoothManager == null) {
      promise.reject("BLE_UNAVAILABLE", "Bluetooth not available on this device")
      return
    }

    val adapter = bluetoothManager!!.adapter
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("BLE_DISABLED", "Bluetooth is not enabled")
      return
    }

    advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      promise.reject("BLE_ADVERTISER_UNAVAILABLE", "BLE advertising not supported on this device")
      return
    }

    openGattServer()
    promise.resolve(null)
  }

  @ReactMethod
  fun startAdvertising(promise: Promise) {
    val adv = advertiser
    if (adv == null) {
      promise.reject("NOT_INITIALIZED", "Call initialize() first")
      return
    }

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setConnectable(true)
      .setTimeout(0)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .build()

    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .setIncludeDeviceName(true)
      .build()

    adv.startAdvertising(settings, data, advertiseCallback)
    promise.resolve(null)
  }

  @ReactMethod
  fun stopAdvertising(promise: Promise) {
    try {
      advertiser?.stopAdvertising(advertiseCallback)
    } catch (e: Exception) {
      Log.w(TAG, "stopAdvertising: ${e.message}")
    }
    isAdvertising = false
    promise.resolve(null)
  }

  @ReactMethod
  fun getState(promise: Promise) {
    val adapter = bluetoothManager?.adapter
    if (adapter == null) {
      promise.resolve("unknown")
      return
    }
    val state = when (adapter.state) {
      BluetoothAdapter.STATE_OFF -> "poweredOff"
      BluetoothAdapter.STATE_ON -> "poweredOn"
      BluetoothAdapter.STATE_TURNING_OFF,
      BluetoothAdapter.STATE_TURNING_ON -> "resetting"
      else -> "unknown"
    }
    promise.resolve(state)
  }

  private fun openGattServer() {
    gattServer = bluetoothManager?.openGattServer(reactContext, gattCallback)
    val service = buildService()
    gattServer?.addService(service)
    Log.i(TAG, "GATT server opened, service added")
  }

  private fun buildService(): BluetoothGattService {
    val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

    val controlPoint = BluetoothGattCharacteristic(
      CONTROL_POINT_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )

    val status = BluetoothGattCharacteristic(
      STATUS_UUID,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    val cccd = BluetoothGattDescriptor(
      CCCD_UUID,
      BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
    )
    status.addDescriptor(cccd)

    val controlPointLength = BluetoothGattCharacteristic(
      CONTROL_POINT_LENGTH_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    controlPointLength.value = byteArrayOf(0x02, 0x00) // 512 big-endian

    val serviceRevision = BluetoothGattCharacteristic(
      SERVICE_REVISION_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ
    )
    serviceRevision.value = "1.0".toByteArray(Charsets.UTF_8)

    service.addCharacteristic(controlPoint)
    service.addCharacteristic(status)
    service.addCharacteristic(controlPointLength)
    service.addCharacteristic(serviceRevision)

    return service
  }

  private fun sendEvent(name: String, params: Any?) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      isAdvertising = true
      Log.i(TAG, "Advertising started")
    }

    override fun onStartFailure(errorCode: Int) {
      isAdvertising = false
      Log.e(TAG, "Advertising failed: errorCode=$errorCode")
    }
  }

  private val gattCallback = object : BluetoothGattServerCallback() {

    override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
      val state = if (newState == BluetoothProfile.STATE_CONNECTED) "connected" else "disconnected"
      Log.i(TAG, "Device ${device?.address}: $state")
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (characteristic?.uuid == CONTROL_POINT_UUID && value != null) {
        val b64 = Base64.encodeToString(value, Base64.NO_WRAP)
        Log.i(TAG, "Control point write: ${value.size} bytes")
        val params = Arguments.createMap().apply { putString("value", b64) }
        sendEvent("ChallengeReceived", params)
        // TODO: [Challenge Flow] Parse FIDO U2F APDU, prompt user, sign with Android Keystore
      }
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
      }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice?,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic?
    ) {
      val value = characteristic?.value ?: ByteArray(0)
      gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      descriptor: BluetoothGattDescriptor?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?
    ) {
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
      }
    }
  }
}
