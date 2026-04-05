import {NativeModules, NativeEventEmitter} from 'react-native';

const {BlePeripheralModule} = NativeModules;

if (!BlePeripheralModule) {
  throw new Error(
    'BlePeripheralModule is not linked. Run pod install (iOS) or rebuild (Android).',
  );
}

export const BlePeripheralEmitter = new NativeEventEmitter(
  BlePeripheralModule,
);

export type BlePeripheralState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn';

export interface BlePeripheralNative {
  initialize(): Promise<void>;
  startAdvertising(): Promise<void>;
  stopAdvertising(): Promise<void>;
  getState(): Promise<BlePeripheralState>;
  approveChallenge(): Promise<void>;
  denyChallenge(): Promise<void>;
  getPublicKey(): Promise<string>;
}

export default BlePeripheralModule as BlePeripheralNative;
