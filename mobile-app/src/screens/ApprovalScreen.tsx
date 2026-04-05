import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BlePeripheralService from '../services/BlePeripheralService';

interface Props {
  visible: boolean;
  challengeHex: string;
  onDismiss: () => void;
}

const TIMEOUT_SECONDS = 30;

export default function ApprovalScreen({visible, challengeHex, onDismiss}: Props) {
  const [remaining, setRemaining] = useState(TIMEOUT_SECONDS);
  const [processing, setProcessing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) {
      setRemaining(TIMEOUT_SECONDS);
      setProcessing(false);
      return;
    }

    setRemaining(TIMEOUT_SECONDS);
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [visible, onDismiss]);

  const handleApprove = useCallback(async () => {
    if (processing) {
      return;
    }
    setProcessing(true);
    try {
      await BlePeripheralService.approveChallenge();
    } catch (err: any) {
      console.error('Approve failed:', err.message);
    }
    onDismiss();
  }, [processing, onDismiss]);

  const handleDeny = useCallback(async () => {
    if (processing) {
      return;
    }
    setProcessing(true);
    try {
      await BlePeripheralService.denyChallenge();
    } catch (err: any) {
      console.error('Deny failed:', err.message);
    }
    onDismiss();
  }, [processing, onDismiss]);

  const preview = challengeHex.length > 16
    ? challengeHex.substring(0, 16) + '...'
    : challengeHex;

  const urgency = remaining <= 10;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <View style={styles.shieldIcon}>
              <Text style={styles.shieldText}>?</Text>
            </View>
          </View>

          <Text style={styles.title}>Login Request</Text>
          <Text style={styles.subtitle}>
            A device is requesting authentication
          </Text>

          <View style={styles.challengeBox}>
            <Text style={styles.challengeLabel}>Challenge</Text>
            <Text style={styles.challengeValue}>{preview}</Text>
          </View>

          <Text style={[styles.timer, urgency && styles.timerUrgent]}>
            {remaining}s remaining
          </Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.denyButton]}
              onPress={handleDeny}
              activeOpacity={0.7}
              disabled={processing}>
              <Text style={styles.denyText}>Deny</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.approveButton]}
              onPress={handleApprove}
              activeOpacity={0.7}
              disabled={processing}>
              <Text style={styles.approveText}>
                {processing ? 'Signing...' : 'Approve'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
  },
  iconRow: {
    marginBottom: 16,
  },
  shieldIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1f6feb33',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shieldText: {
    fontSize: 28,
    color: '#58a6ff',
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center',
    marginBottom: 20,
  },
  challengeBox: {
    backgroundColor: '#0d1117',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#21262d',
  },
  challengeLabel: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  challengeValue: {
    fontSize: 14,
    color: '#58a6ff',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  timer: {
    fontSize: 15,
    color: '#8b949e',
    marginBottom: 24,
    fontWeight: '600',
  },
  timerUrgent: {
    color: '#f85149',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  denyButton: {
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  approveButton: {
    backgroundColor: '#238636',
  },
  denyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f85149',
  },
  approveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
