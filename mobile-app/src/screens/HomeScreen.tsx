import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  type AppStateStatus,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BlePeripheralService from '../services/BlePeripheralService';
import type {BlePeripheralState} from '../services/NativeBlePeripheral';
import ApprovalScreen from './ApprovalScreen';

type LogEntry = {time: string; message: string};

const STATE_LABELS: Record<BlePeripheralState, string> = {
  unknown: 'Initializing...',
  resetting: 'Bluetooth Resetting',
  unsupported: 'BLE Not Supported',
  unauthorized: 'Bluetooth Permission Denied',
  poweredOff: 'Bluetooth is Off',
  poweredOn: 'Bluetooth Ready',
};

const STATE_COLORS: Record<BlePeripheralState, string> = {
  unknown: '#888',
  resetting: '#f0ad4e',
  unsupported: '#d9534f',
  unauthorized: '#d9534f',
  poweredOff: '#d9534f',
  poweredOn: '#5cb85c',
};

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const apiLevel = Platform.Version;
  if (typeof apiLevel === 'number' && apiLevel >= 31) {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(results).every(
      r => r === PermissionsAndroid.RESULTS.GRANTED,
    );
  }
  const loc = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return loc === PermissionsAndroid.RESULTS.GRANTED;
}

export default function HomeScreen() {
  const [bleState, setBleState] = useState<BlePeripheralState>('unknown');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [challengeVisible, setChallengeVisible] = useState(false);
  const [challengeHex, setChallengeHex] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), {time, message}]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const granted = await requestAndroidPermissions();
      if (!granted) {
        addLog('BLE permissions denied');
        return;
      }
      try {
        await BlePeripheralService.initialize();
        if (!mounted) {
          return;
        }
        const state = await BlePeripheralService.getState();
        setBleState(state);
        addLog(`Initialized — state: ${state}`);
      } catch (err: any) {
        addLog(`Init error: ${err.message}`);
      }
    }

    const unsubState = BlePeripheralService.onStateChange(state => {
      setBleState(state);
      if (state === 'poweredOn') {
        addLog('Bluetooth on — advertising automatically');
      } else {
        addLog(`State changed: ${state}`);
      }
    });

    const unsubChallenge = BlePeripheralService.onChallengeReceived(data => {
      addLog(`Challenge received (${data.size} bytes)`);
      setChallengeHex(data.value);
      setChallengeVisible(true);
    });

    const unsubDismiss = BlePeripheralService.onChallengeDismissed(data => {
      addLog(`Challenge dismissed: ${data.reason}`);
      setChallengeVisible(false);
    });

    init();

    return () => {
      mounted = false;
      unsubState();
      unsubChallenge();
      unsubDismiss();
      BlePeripheralService.destroy();
    };
  }, [addLog]);

  useEffect(() => {
    function handleAppState(nextState: AppStateStatus) {
      if (nextState === 'active') {
        BlePeripheralService.getState()
          .then(setBleState)
          .catch(() => {});
      }
    }
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  const isReady = bleState === 'poweredOn';
  const indicatorColor = STATE_COLORS[bleState];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.title}>FIDO2 BLE Key</Text>
        <Text style={styles.subtitle}>Phone-as-Security-Key</Text>
      </View>

      <View style={styles.stateCard}>
        <View style={styles.stateRow}>
          <View style={[styles.indicator, {backgroundColor: indicatorColor}]} />
          <Text style={styles.stateText}>{STATE_LABELS[bleState]}</Text>
        </View>
        {isReady && (
          <Text style={styles.advertisingBadge}>ADVERTISING 0xFFFD</Text>
        )}
      </View>

      {bleState === 'poweredOff' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            Bluetooth is turned off. Enable it in your device settings to use
            this app as a security key.
          </Text>
        </View>
      )}

      {bleState === 'unauthorized' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningText}>
            Bluetooth permission was denied. Grant permission in Settings to
            allow BLE advertising.
          </Text>
        </View>
      )}

      <ApprovalScreen
        visible={challengeVisible}
        challengeHex={challengeHex}
        onDismiss={() => {
          setChallengeVisible(false);
          addLog('Approval dialog closed');
        }}
      />

      <View style={styles.logContainer}>
        <Text style={styles.logHeader}>Event Log</Text>
        <ScrollView
          ref={scrollRef}
          style={styles.logScroll}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({animated: true})
          }>
          {logs.map((entry, i) => (
            <Text key={i} style={styles.logEntry}>
              <Text style={styles.logTime}>{entry.time}</Text> {entry.message}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.logEmpty}>No events yet</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e6edf3',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    marginTop: 4,
  },
  stateCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  stateText: {
    fontSize: 16,
    color: '#e6edf3',
    fontWeight: '500',
  },
  advertisingBadge: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#3fb950',
    letterSpacing: 1,
  },
  warningCard: {
    backgroundColor: '#2d1b00',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#6e4000',
  },
  warningText: {
    fontSize: 14,
    color: '#f0ad4e',
    lineHeight: 20,
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
    marginBottom: 20,
  },
  logHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  logScroll: {
    flex: 1,
  },
  logEntry: {
    fontSize: 13,
    color: '#c9d1d9',
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logTime: {
    color: '#58a6ff',
  },
  logEmpty: {
    fontSize: 13,
    color: '#484f58',
    fontStyle: 'italic',
  },
});
