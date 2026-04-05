export type AuthMode = 'proximity' | 'tap' | 'standard_2fa' | 'loose';

export interface AuthConfig {
  authMode: AuthMode;
  /** RSSI threshold in dBm. Closer to 0 = nearer device required. */
  proximityDistance: number;
}

/**
 * Auth mode behavior:
 *
 *   standard_2fa  — BLE not used. Falls back to manual TOTP code entry.
 *   tap           — BLE challenge sent. User must tap Approve on phone.
 *   proximity     — BLE challenge sent. Auto-approved if phone is within
 *                   proximityDistance RSSI threshold. No tap required.
 *   loose         — BLE challenge sent. Auto-approved whenever BLE
 *                   connection is active, regardless of signal strength.
 *
 * Wire protocol:
 *   Control point write = mode_byte(1) + challenge(32)
 *   mode_byte 0x00 = tap (show UI on phone)
 *   mode_byte 0x01 = auto (phone signs immediately, no UI)
 *
 * Relay attack mitigation:
 *   Challenge embeds an 8-byte timestamp. Laptop rejects responses with
 *   round-trip time > 5 seconds.
 */

export const DISTANCE_PRESETS: Record<string, {meters: number; rssi: number}> = {
  touch: {meters: 0.1, rssi: -49},
  near: {meters: 1.0, rssi: -59},
  room: {meters: 2.0, rssi: -65},
  far: {meters: 5.0, rssi: -73},
};

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  authMode: 'tap',
  proximityDistance: -65, // ~2 meters
};
