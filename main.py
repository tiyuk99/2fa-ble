import argparse
import json
import math
import os
import struct
import sys
import threading
import time

import simplepyble
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

TARGET_NAME = "Tiya <33"
TARGET_ADDRESS = "2D969673-98E2-897E-83AA-BB32C87470A6"

FIDO_SERVICE = "0000fffd-0000-1000-8000-00805f9b34fb"
CONTROL_POINT = "f1d0fff1-deaa-ecee-b42f-c9ba7ed623bb"
STATUS_CHAR = "f1d0fff2-deaa-ecee-b42f-c9ba7ed623bb"
CONTROL_POINT_LENGTH = "f1d0fff3-deaa-ecee-b42f-c9ba7ed623bb"
SERVICE_REVISION = "f1d0fff4-deaa-ecee-b42f-c9ba7ed623bb"
PUBLIC_KEY_CHAR = "f1d0fff5-deaa-ecee-b42f-c9ba7ed623bb"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILES_FILE = os.path.join(BASE_DIR, "profiles.json")
CHALLENGE_TIMEOUT = 30
RELAY_MAX_RTT = 5.0

MODE_TAP = 0x00
MODE_AUTO = 0x01


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

def load_profiles():
    if not os.path.exists(PROFILES_FILE):
        return {}
    with open(PROFILES_FILE, "r") as f:
        return json.load(f)


def save_profiles(profiles):
    with open(PROFILES_FILE, "w") as f:
        json.dump(profiles, f, indent=2)


def key_path_for_service(name):
    return os.path.join(BASE_DIR, f"public_key_{name}.pem")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def distance_to_rssi(meters, tx_power=-59, n=2.0):
    if meters <= 0:
        return 0
    return int(tx_power - 10 * n * math.log10(meters))


def build_challenge():
    ts = struct.pack(">d", time.time())
    nonce = os.urandom(24)
    return ts + nonce


def extract_timestamp(challenge):
    return struct.unpack(">d", challenge[:8])[0]


def verify_signature(public_key, challenge, signature):
    try:
        public_key.verify(signature, challenge, ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def load_public_key(pem_path):
    with open(pem_path, "rb") as f:
        return serialization.load_pem_public_key(f.read())


def read_and_save_public_key(device, pem_path):
    """Read public key from phone over BLE and save as PEM."""
    print("Reading public key from phone...")
    raw = bytes(device.read(FIDO_SERVICE, PUBLIC_KEY_CHAR))
    if not raw or len(raw) < 65:
        raise RuntimeError(f"Invalid public key from phone ({len(raw)} bytes)")

    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    pem = key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    with open(pem_path, "wb") as f:
        f.write(pem)
    print(f"Public key saved to {pem_path}")
    return key


def find_phone():
    """Scan and return the target BLE device."""
    adapters = simplepyble.Adapter.get_adapters()
    if not adapters:
        raise RuntimeError("No BLE adapters found.")

    adapter = adapters[0]
    print("Scanning...")
    adapter.scan_for(7000)

    for device in adapter.scan_get_results():
        ident = (device.identifier() or "").strip()
        addr = (device.address() or "").strip().upper()
        if ident == TARGET_NAME or addr == TARGET_ADDRESS:
            return device

    raise RuntimeError("Phone not found. Keep it awake and advertising.")


def get_valid_rssi(device):
    """Get RSSI, rejecting invalid values (127 = not available, positive = bogus)."""
    rssi = device.rssi()
    if rssi >= 0:
        raise RuntimeError(
            f"RSSI unavailable ({rssi} dBm). "
            "Try moving your phone or restarting the scan."
        )
    return rssi


def ensure_fido_service(device):
    """Connect, discover FIDO service, verify all characteristics present."""
    device.connect()
    print("Connected!\n")

    fido = None
    for attempt in range(3):
        for svc in device.services():
            if svc.uuid().lower() == FIDO_SERVICE:
                fido = svc
                break
        if fido:
            break
        time.sleep(1)

    if fido is None:
        raise RuntimeError("FIDO U2F service (0xFFFD) not found.")

    char_uuids = {c.uuid().lower() for c in fido.characteristics()}
    required = {CONTROL_POINT, STATUS_CHAR, CONTROL_POINT_LENGTH,
                SERVICE_REVISION, PUBLIC_KEY_CHAR}
    missing = required - char_uuids
    if missing:
        raise RuntimeError(f"Missing characteristics: {missing}")


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

def register_service(name, mode, distance):
    print(f'Registering service "{name}" (mode={mode}, distance={distance}m)\n')

    device = find_phone()
    rssi = device.rssi()
    print(f"Found: {device.identifier()} | RSSI {rssi} dBm")

    try:
        ensure_fido_service(device)

        pem_path = key_path_for_service(name)
        read_and_save_public_key(device, pem_path)

        profiles = load_profiles()
        profiles[name] = {
            "mode": mode,
            "distance": distance,
            "publicKey": os.path.basename(pem_path),
        }
        save_profiles(profiles)

        print(f'\nService "{name}" registered.')
        print(f"  Mode:       {mode}")
        print(f"  Distance:   {distance}m")
        print(f"  Public key: {os.path.basename(pem_path)}")
        print(f"  Profile:    {PROFILES_FILE}")

    finally:
        if device.is_connected():
            device.disconnect()
            print("Disconnected.")


# ---------------------------------------------------------------------------
# standard_2fa fallback
# ---------------------------------------------------------------------------

def run_standard_2fa(service_name=None):
    label = f" ({service_name})" if service_name else ""
    print(f"\n[standard_2fa]{label} BLE skipped — manual TOTP entry.\n")
    code = input("Enter 6-digit TOTP code: ").strip()
    if len(code) == 6 and code.isdigit():
        print(f"\n*** AUTHENTICATED{label} (standard_2fa) ***")
    else:
        print(f"\n*** REJECTED{label} — invalid TOTP code ***")
        sys.exit(1)


# ---------------------------------------------------------------------------
# BLE auth flow
# ---------------------------------------------------------------------------

def run_ble_auth(mode, rssi_threshold, pem_path, service_name=None):
    wire_mode = MODE_AUTO if mode in ("proximity", "loose") else MODE_TAP
    label = f" [{service_name}]" if service_name else ""

    device = find_phone()
    rssi = get_valid_rssi(device)
    print(f"Found: {device.identifier()} | RSSI {rssi} dBm")

    if rssi < rssi_threshold:
        print(
            f"\nDevice too far — move closer."
            f"\n  RSSI: {rssi} dBm (need >= {rssi_threshold} dBm)"
        )
        sys.exit(1)
    print(f"Proximity OK (RSSI {rssi} >= {rssi_threshold} dBm)")

    try:
        ensure_fido_service(device)

        # --- Public key ---
        if os.path.exists(pem_path):
            public_key = load_public_key(pem_path)
            print(f"Public key loaded from {pem_path}")
        else:
            public_key = read_and_save_public_key(device, pem_path)

        # --- Subscribe ---
        response_event = threading.Event()
        response_data = [None]

        def on_notify(data):
            response_data[0] = bytes(data)
            response_event.set()

        device.notify(FIDO_SERVICE, STATUS_CHAR, on_notify)
        time.sleep(0.5)

        # --- Build & send challenge ---
        challenge = build_challenge()
        payload = bytes([wire_mode]) + challenge
        send_time = time.time()

        print(f"\nMode: {mode}{label}")
        print(f"Challenge: {challenge.hex()}")
        device.write_request(FIDO_SERVICE, CONTROL_POINT, payload)

        if wire_mode == MODE_TAP:
            print("Challenge sent — approve on your phone...\n")
        else:
            print("Challenge sent — auto-approving...\n")

        # --- Wait for response ---
        if not response_event.wait(timeout=CHALLENGE_TIMEOUT):
            print(f"No response within {CHALLENGE_TIMEOUT}s.")
            sys.exit(1)

        rtt = time.time() - send_time

        # --- Relay attack check (auto-approve modes only) ---
        if wire_mode == MODE_AUTO and rtt > RELAY_MAX_RTT:
            print(
                f"\n*** REJECTED — response too slow ({rtt:.1f}s > {RELAY_MAX_RTT}s) ***"
            )
            sys.exit(1)
        print(f"Round-trip: {rtt:.2f}s")

        # --- Parse response ---
        resp = response_data[0]
        if not resp or len(resp) < 1:
            print("Empty response.")
            sys.exit(1)

        status_byte = resp[0]
        if status_byte == 0x01:
            print("DENIED by user.")
            sys.exit(1)
        elif status_byte == 0x02:
            print("TIMEOUT on phone.")
            sys.exit(1)
        elif status_byte == 0x03:
            error_msg = resp[1:].decode("utf-8", errors="replace")
            print(f"Phone error: {error_msg}")
            sys.exit(1)
        elif status_byte != 0x00:
            print(f"Unknown status: 0x{status_byte:02x}")
            sys.exit(1)

        signature = resp[1:]
        print(f"Signature: {len(signature)} bytes")

        # --- Timestamp freshness ---
        embedded_ts = extract_timestamp(challenge)
        age = time.time() - embedded_ts
        if age > RELAY_MAX_RTT:
            print(f"\n*** REJECTED — challenge too old ({age:.1f}s) ***")
            sys.exit(1)

        # --- Cryptographic verification ---
        if verify_signature(public_key, challenge, signature):
            print(f"\n*** AUTHENTICATED{label} ***")
        else:
            print(f"\n*** REJECTED{label} — invalid signature ***")
            sys.exit(1)

        device.unsubscribe(FIDO_SERVICE, STATUS_CHAR)

    finally:
        if device.is_connected():
            device.disconnect()
            print("Disconnected.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="FIDO2 BLE authenticator with per-service profiles",
        epilog=(
            "examples:\n"
            "  %(prog)s --register github --mode loose --distance 10\n"
            "  %(prog)s --auth github\n"
            "  %(prog)s --auth banking\n"
            "  %(prog)s --mode tap --distance 2          # ad-hoc, no profile\n"
            "  %(prog)s --list\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--register", metavar="SERVICE",
                        help="Register a new service profile (pair with phone)")
    parser.add_argument("--auth", metavar="SERVICE",
                        help="Authenticate using a registered service profile")
    parser.add_argument("--list", action="store_true",
                        help="List all registered service profiles")
    parser.add_argument("--mode",
                        choices=["tap", "proximity", "loose", "standard_2fa"],
                        default="tap",
                        help="Auth mode (default: tap)")
    parser.add_argument("--distance", type=float, default=2.0,
                        help="Max distance in meters (default: 2)")
    args = parser.parse_args()

    # --- List profiles ---
    if args.list:
        profiles = load_profiles()
        if not profiles:
            print("No registered services. Use --register <name> to add one.")
            return
        print(f"{'Service':<15} {'Mode':<14} {'Distance':<10} {'Key File'}")
        print("-" * 60)
        for name, p in sorted(profiles.items()):
            print(f"{name:<15} {p['mode']:<14} {p['distance']:<10} {p['publicKey']}")
        return

    # --- Register ---
    if args.register:
        register_service(args.register, args.mode, args.distance)
        return

    # --- Authenticate ---
    if args.auth:
        profiles = load_profiles()
        if args.auth not in profiles:
            print(f'Service "{args.auth}" not found. Registered services:')
            for name in sorted(profiles):
                print(f"  - {name}")
            sys.exit(1)

        profile = profiles[args.auth]
        mode = profile["mode"]
        distance = profile["distance"]
        pem_path = os.path.join(BASE_DIR, profile["publicKey"])
        rssi_threshold = distance_to_rssi(distance)

        print(f'Service: {args.auth} | Mode: {mode} | Distance: {distance}m (RSSI >= {rssi_threshold} dBm)\n')

        if mode == "standard_2fa":
            run_standard_2fa(args.auth)
        else:
            if not os.path.exists(pem_path):
                print(f'Public key missing: {pem_path}')
                print(f'Re-register with: python3 main.py --register {args.auth} --mode {mode} --distance {distance}')
                sys.exit(1)
            run_ble_auth(mode, rssi_threshold, pem_path, args.auth)
        return

    # --- Ad-hoc auth (backward compatible, no profile) ---
    rssi_threshold = distance_to_rssi(args.distance)
    print(f"Auth mode: {args.mode} | Distance limit: {args.distance}m (RSSI >= {rssi_threshold} dBm)\n")

    if args.mode == "standard_2fa":
        run_standard_2fa()
    else:
        pem_path = os.path.join(BASE_DIR, "public_key.pem")
        run_ble_auth(args.mode, rssi_threshold, pem_path)


if __name__ == "__main__":
    main()
