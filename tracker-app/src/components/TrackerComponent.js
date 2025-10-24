import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { DEFAULT_TRACKER_TYPES, generateColorFromName, calculateBrightness } from '../utils/constants';

const TrackerComponent = ({ type, value, onIncrement, onDecrement }) => {
  const shakeAnimation = new Animated.Value(0);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleDecrement = () => {
    if (value <= 0) {
      shake();
      return;
    }
    onDecrement();
  };

  // Get colors for the tracker
  let backgroundColor, textColor;
  if (DEFAULT_TRACKER_TYPES[type]) {
    backgroundColor = DEFAULT_TRACKER_TYPES[type].color;
    textColor = DEFAULT_TRACKER_TYPES[type].textColor;
  } else {
    backgroundColor = generateColorFromName(type);
    const brightness = calculateBrightness(backgroundColor);
    textColor = brightness > 128 ? '#1e1e2e' : '#cdd6f4';
  }

  return (
    <Animated.View 
      style={[
        styles.trackerContainer, 
        { backgroundColor },
        { transform: [{ translateX: shakeAnimation }] }
      ]}
    >
      <Text style={[styles.trackerLabel, { color: textColor }]}>{type}</Text>
      <View style={styles.counterSection}>
        <TouchableOpacity
          style={[styles.button, styles.decrementButton, value <= 0 && styles.disabledButton]}
          onPress={handleDecrement}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, { color: textColor }]}>−</Text>
        </TouchableOpacity>
        
        <View style={styles.valueContainer}>
          <Text style={[styles.counterValue, { color: textColor }]}>{value}</Text>
        </View>
        
        <TouchableOpacity
          style={[styles.button, styles.incrementButton]}
          onPress={onIncrement}
          activeOpacity={0.7}
        >
          <Text style={[styles.buttonText, { color: textColor }]}>+</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  trackerContainer: {
    marginBottom: 10,
    borderRadius: 8,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  trackerLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  counterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
  },
  button: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  decrementButton: {
    marginRight: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  incrementButton: {
    marginLeft: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  valueContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
});

export default TrackerComponent;
