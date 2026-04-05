import Foundation
import Security

final class SecureEnclaveManager {

  static let shared = SecureEnclaveManager()

  private let keyTag = "com.fido2blekey.auth.v2".data(using: .utf8)!

  private init() {
    // Clean up any broken keys from previous installs on first access
    migrateIfNeeded()
  }

  private func migrateIfNeeded() {
    let oldTag = "com.fido2blekey.auth.secp256r1".data(using: .utf8)!
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: oldTag,
    ]
    SecItemDelete(query as CFDictionary)
  }

  // MARK: - Key lifecycle

  func getOrCreateKeyPair() throws -> SecKey {
    if let existing = loadPrivateKey() {
      return existing
    }
    return try generateKeyPair()
  }

  private func generateKeyPair() throws -> SecKey {
    // Delete any existing key first to avoid duplicates
    deleteKey()

    var error: Unmanaged<CFError>?
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
      ],
    ]

    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw SEError.keyGenerationFailed(error?.takeRetainedValue())
    }

    NSLog("[KeyManager] P-256 key pair generated")
    return privateKey
  }

  private func loadPrivateKey() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess {
      return (item as! SecKey)
    }
    return nil
  }

  private func deleteKey() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
    ]
    SecItemDelete(query as CFDictionary)
  }

  // MARK: - Signing

  func sign(challenge: Data) throws -> Data {
    let privateKey = try getOrCreateKeyPair()

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureMessageX962SHA256,
      challenge as CFData,
      &error
    ) else {
      throw SEError.signingFailed(error?.takeRetainedValue())
    }

    return signature as Data
  }

  // MARK: - Public key export

  func publicKeyData() throws -> Data {
    let privateKey = try getOrCreateKeyPair()

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw SEError.publicKeyExtractionFailed
    }

    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) else {
      throw SEError.publicKeyExportFailed(error?.takeRetainedValue())
    }

    return data as Data
  }

  // MARK: - Errors

  enum SEError: LocalizedError {
    case keyGenerationFailed(CFError?)
    case signingFailed(CFError?)
    case publicKeyExtractionFailed
    case publicKeyExportFailed(CFError?)

    var errorDescription: String? {
      switch self {
      case .keyGenerationFailed(let e):   return "Key generation: \(e?.localizedDescription ?? "unknown")"
      case .signingFailed(let e):         return "Signing: \(e?.localizedDescription ?? "unknown")"
      case .publicKeyExtractionFailed:    return "Could not extract public key"
      case .publicKeyExportFailed(let e): return "Public key export: \(e?.localizedDescription ?? "unknown")"
      }
    }
  }
}
