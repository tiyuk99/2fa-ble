import NativeBlePeripheral, {
  BlePeripheralEmitter,
  type BlePeripheralState,
} from './NativeBlePeripheral';
import type {EmitterSubscription} from 'react-native';

type StateListener = (state: BlePeripheralState) => void;
type ChallengeListener = (data: {value: string; size: number}) => void;
type DismissListener = (data: {reason: string}) => void;

class BlePeripheralService {
  private stateSubscription: EmitterSubscription | null = null;
  private challengeSubscription: EmitterSubscription | null = null;
  private dismissSubscription: EmitterSubscription | null = null;

  async initialize(): Promise<void> {
    await NativeBlePeripheral.initialize();
  }

  async startAdvertising(): Promise<void> {
    await NativeBlePeripheral.startAdvertising();
  }

  async stopAdvertising(): Promise<void> {
    await NativeBlePeripheral.stopAdvertising();
  }

  async getState(): Promise<BlePeripheralState> {
    return NativeBlePeripheral.getState();
  }

  async approveChallenge(): Promise<void> {
    await NativeBlePeripheral.approveChallenge();
  }

  async denyChallenge(): Promise<void> {
    await NativeBlePeripheral.denyChallenge();
  }

  async getPublicKey(): Promise<string> {
    return NativeBlePeripheral.getPublicKey();
  }

  onStateChange(listener: StateListener): () => void {
    this.stateSubscription?.remove();
    this.stateSubscription = BlePeripheralEmitter.addListener(
      'BlePeripheralStateChanged',
      listener,
    );
    return () => this.stateSubscription?.remove();
  }

  onChallengeReceived(listener: ChallengeListener): () => void {
    this.challengeSubscription?.remove();
    this.challengeSubscription = BlePeripheralEmitter.addListener(
      'ChallengeReceived',
      listener,
    );
    return () => this.challengeSubscription?.remove();
  }

  onChallengeDismissed(listener: DismissListener): () => void {
    this.dismissSubscription?.remove();
    this.dismissSubscription = BlePeripheralEmitter.addListener(
      'ChallengeDismissed',
      listener,
    );
    return () => this.dismissSubscription?.remove();
  }

  destroy(): void {
    this.stateSubscription?.remove();
    this.challengeSubscription?.remove();
    this.dismissSubscription?.remove();
  }
}

export default new BlePeripheralService();
