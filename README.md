# 2FA-BLE

Two-factor authentication over Bluetooth Low Energy (BLE) using FIDO U2F.

A proximity-based 2FA system where your phone acts as the authenticator, communicating with a desktop client over BLE. Supports multiple security modes — proximity, tap, and loose — with configurable distance thresholds.

## Components

- **Python backend** (`app.py`, `main.py`) — Flask server that handles BLE communication, challenge/response, and FIDO U2F signature verification
- **Web app** (`web-app/`) — Next.js frontend for service setup and authentication flows
- **Mobile app** (`mobile-app/`) — React Native app that acts as the BLE authenticator

## Setup

### Backend
```bash
pip install flask flask-cors bleak cryptography
python app.py
```

### Web App
```bash
cd web-app
npm install
npm run dev
```

### Mobile App
```bash
cd mobile-app
npm install
npx react-native run-ios
```
