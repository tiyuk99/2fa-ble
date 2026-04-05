import json
import os
import threading
import time

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

from main import (
    CONTROL_POINT,
    FIDO_SERVICE,
    PUBLIC_KEY_CHAR,
    RELAY_MAX_RTT,
    STATUS_CHAR,
    MODE_AUTO,
    MODE_TAP,
    build_challenge,
    distance_to_rssi,
    extract_timestamp,
    find_phone,
    get_valid_rssi,
    ensure_fido_service,
    load_public_key,
    read_and_save_public_key,
    verify_signature,
)

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILES_FILE = os.path.join(BASE_DIR, "profiles.json")
CHALLENGE_TIMEOUT = 30


def load_profiles():
    if not os.path.exists(PROFILES_FILE):
        return {}
    with open(PROFILES_FILE, "r") as f:
        return json.load(f)


def save_profiles(profiles):
    with open(PROFILES_FILE, "w") as f:
        json.dump(profiles, f, indent=2)


def sse(step, icon, label, **extra):
    payload = {"step": step, "icon": icon, "label": label, **extra}
    return f"data: {json.dumps(payload)}\n\n"


@app.route("/profiles", methods=["GET"])
def get_profiles():
    return jsonify(load_profiles())


@app.route("/register", methods=["POST"])
def register():
    data = request.json
    name = data.get("name", "").strip()
    mode = data.get("mode", "proximity")
    distance = float(data.get("distance", 2))

    if not name:
        return jsonify({"error": "Service name is required"}), 400

    profiles = load_profiles()
    profiles[name] = {
        "mode": mode,
        "distance": distance,
        "publicKey": f"public_key_{name}.pem",
    }
    save_profiles(profiles)
    return jsonify({"status": "ok", "service": name})


@app.route("/auth-stream/<service>")
def auth_stream(service):
    def generate():
        profiles = load_profiles()
        if service not in profiles:
            yield sse("result", "🔴", "Service not registered", status="rejected")
            return

        profile = profiles[service]
        mode = profile["mode"]
        distance = profile["distance"]
        rssi_threshold = distance_to_rssi(distance)
        wire_mode = MODE_AUTO if mode in ("proximity", "loose") else MODE_TAP
        pem_path = os.path.join(BASE_DIR, profile["publicKey"])

        device = None

        try:
            # Step 1: Find phone
            yield sse("finding", "📱", "Looking for your phone...")

            try:
                device = find_phone()
            except RuntimeError:
                yield sse("result", "🔴", "Phone not found", status="rejected")
                return

            try:
                rssi = get_valid_rssi(device)
            except RuntimeError:
                yield sse("result", "🔴", "Could not read signal strength — try again", status="rejected")
                return

            phone_name = device.identifier().strip()
            yield sse("found", "📱", f"Found {phone_name}")

            # Step 2: Check distance
            yield sse("distance", "📏", "Checking distance...")
            time.sleep(0.3)

            if rssi < rssi_threshold:
                yield sse("result", "🔴", "Phone too far away — move closer", status="rejected")
                return

            yield sse("close_enough", "📏", "Phone is close enough")

            # Step 3: Verify (all the crypto happens here, silently)
            yield sse("verifying", "🔒", "Verifying...")

            ensure_fido_service(device)

            if os.path.exists(pem_path):
                public_key = load_public_key(pem_path)
            else:
                public_key = read_and_save_public_key(device, pem_path)

            response_event = threading.Event()
            response_data = [None]

            def on_notify(data):
                response_data[0] = bytes(data)
                response_event.set()

            device.notify(FIDO_SERVICE, STATUS_CHAR, on_notify)
            time.sleep(0.5)

            challenge = build_challenge()
            payload = bytes([wire_mode]) + challenge
            send_time = time.time()

            device.write_request(FIDO_SERVICE, CONTROL_POINT, payload)

            if not response_event.wait(timeout=CHALLENGE_TIMEOUT):
                yield sse("result", "🔴", "Phone didn't respond in time", status="rejected")
                return

            rtt = time.time() - send_time
            resp = response_data[0]

            if not resp or len(resp) < 1 or resp[0] != 0x00:
                yield sse("result", "🔴", "Authentication failed", status="rejected")
                return

            signature = resp[1:]

            if wire_mode == MODE_AUTO and rtt > RELAY_MAX_RTT:
                yield sse("result", "🔴", "Authentication failed", status="rejected")
                return

            embedded_ts = extract_timestamp(challenge)
            if time.time() - embedded_ts > RELAY_MAX_RTT:
                yield sse("result", "🔴", "Authentication failed", status="rejected")
                return

            if not verify_signature(public_key, challenge, signature):
                yield sse("result", "🔴", "Authentication failed", status="rejected")
                return

            device.unsubscribe(FIDO_SERVICE, STATUS_CHAR)

            # Step 4: Done
            yield sse("result", "🟢", "AUTHENTICATED", status="authenticated")

        except Exception:
            yield sse("result", "🔴", "Something went wrong — try again", status="rejected")

        finally:
            try:
                if device and device.is_connected():
                    device.disconnect()
            except Exception:
                pass

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    app.run(port=8000, debug=True)
