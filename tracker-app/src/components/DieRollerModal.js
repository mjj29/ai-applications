import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Animated,
} from 'react-native';

const DieRollerModal = ({ visible, onClose, dieSides, onDieSidesChange }) => {
  const [result, setResult] = useState('?');
  const [isRolling, setIsRolling] = useState(false);
  const [localDieSides, setLocalDieSides] = useState(dieSides.toString());
  const rollAnimation = new Animated.Value(0);

  const rollDie = () => {
    if (isRolling) return;

    setIsRolling(true);
    
    // Start roll animation
    Animated.sequence([
      Animated.timing(rollAnimation, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(rollAnimation, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(rollAnimation, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(rollAnimation, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Simulate rolling animation with multiple random numbers
    let rollCount = 0;
    const rollInterval = setInterval(() => {
      const tempResult = Math.floor(Math.random() * parseInt(localDieSides)) + 1;
      setResult(tempResult.toString());
      rollCount++;
      
      if (rollCount >= 8) {
        clearInterval(rollInterval);
        const finalResult = Math.floor(Math.random() * parseInt(localDieSides)) + 1;
        setResult(finalResult.toString());
        setIsRolling(false);
      }
    }, 100);
  };

  const handleDieSidesChange = (value) => {
    setLocalDieSides(value);
    const numValue = parseInt(value) || 6;
    if (numValue >= 2 && numValue <= 100) {
      onDieSidesChange(numValue);
    }
  };

  const spin = rollAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Die Roller</Text>
          
          <View style={styles.dieContainer}>
            <Animated.View 
              style={[
                styles.dieResult,
                { transform: [{ rotate: spin }] }
              ]}
            >
              <Text style={styles.dieResultText}>{result}</Text>
            </Animated.View>
          </View>

          <View style={styles.configContainer}>
            <Text style={styles.configLabel}>Number of sides:</Text>
            <TextInput
              style={styles.sidesInput}
              value={localDieSides}
              onChangeText={handleDieSidesChange}
              keyboardType="numeric"
              maxLength={3}
            />
          </View>

          <TouchableOpacity
            style={[styles.rollButton, isRolling && styles.rollButtonDisabled]}
            onPress={rollDie}
            disabled={isRolling}
          >
            <Text style={styles.rollButtonText}>
              {isRolling ? 'Rolling...' : 'Roll'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#2a2a3e',
    borderRadius: 10,
    padding: 20,
    width: '80%',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#cdd6f4',
    textAlign: 'center',
    marginBottom: 30,
  },
  dieContainer: {
    marginVertical: 30,
  },
  dieResult: {
    width: 120,
    height: 120,
    borderRadius: 15,
    backgroundColor: '#45475a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#89b4fa',
  },
  dieResultText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#cdd6f4',
  },
  configContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  configLabel: {
    fontSize: 16,
    color: '#cdd6f4',
    marginRight: 10,
  },
  sidesInput: {
    backgroundColor: '#45475a',
    color: '#cdd6f4',
    padding: 10,
    borderRadius: 6,
    fontSize: 16,
    textAlign: 'center',
    minWidth: 60,
    borderWidth: 1,
    borderColor: '#89b4fa',
  },
  rollButton: {
    backgroundColor: '#a6e3a1',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 6,
    marginVertical: 20,
  },
  rollButtonDisabled: {
    backgroundColor: '#6c7086',
  },
  rollButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 18,
  },
  closeButton: {
    backgroundColor: '#89b4fa',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 6,
  },
  closeButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default DieRollerModal;
