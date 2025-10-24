import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { DEFAULT_TRACKER_TYPES } from '../utils/constants';

const ConfigModal = ({ 
  visible, 
  onClose, 
  activeTrackers, 
  customTrackers, 
  onSave 
}) => {
  const [selectedTrackers, setSelectedTrackers] = useState(activeTrackers);
  const [localCustomTrackers, setLocalCustomTrackers] = useState(customTrackers);
  const [newTrackerName, setNewTrackerName] = useState('');

  // Update local state when modal becomes visible or props change
  useEffect(() => {
    if (visible) {
      setSelectedTrackers([...activeTrackers]);
      setLocalCustomTrackers([...customTrackers]);
      setNewTrackerName('');
    }
  }, [visible, activeTrackers, customTrackers]);

  const toggleTracker = (trackerType) => {
    setSelectedTrackers(prev => 
      prev.includes(trackerType) 
        ? prev.filter(t => t !== trackerType)
        : [...prev, trackerType]
    );
  };

  const addCustomTracker = () => {
    if (!newTrackerName.trim()) {
      Alert.alert('Error', 'Please enter a tracker name');
      return;
    }

    if (localCustomTrackers.includes(newTrackerName.trim())) {
      Alert.alert('Error', 'This tracker already exists');
      return;
    }

    const newTracker = newTrackerName.trim();
    setLocalCustomTrackers(prev => [...prev, newTracker]);
    setSelectedTrackers(prev => [...prev, newTracker]);
    setNewTrackerName('');
  };

  const removeCustomTracker = (trackerName) => {
    Alert.alert(
      'Remove Tracker',
      `Are you sure you want to remove "${trackerName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setLocalCustomTrackers(prev => prev.filter(t => t !== trackerName));
            setSelectedTrackers(prev => prev.filter(t => t !== trackerName));
          }
        }
      ]
    );
  };

  const handleSave = () => {
    onSave(selectedTrackers, localCustomTrackers);
    onClose();
  };

  const handleCancel = () => {
    setSelectedTrackers(activeTrackers);
    setLocalCustomTrackers(customTrackers);
    setNewTrackerName('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Configure Trackers</Text>
          
          <ScrollView style={styles.scrollContainer}>
            <Text style={styles.sectionTitle}>Built-in Trackers</Text>
            {Object.keys(DEFAULT_TRACKER_TYPES).map(type => (
              <TouchableOpacity
                key={type}
                style={styles.checkboxItem}
                onPress={() => toggleTracker(type)}
              >
                <View style={[
                  styles.checkbox,
                  selectedTrackers.includes(type) && styles.checkboxSelected
                ]}>
                  {selectedTrackers.includes(type) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.checkboxLabel}>{type}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.sectionTitle}>Custom Trackers</Text>
            {localCustomTrackers.map(tracker => (
              <View key={tracker} style={styles.customTrackerItem}>
                <TouchableOpacity
                  style={styles.checkboxItem}
                  onPress={() => toggleTracker(tracker)}
                >
                  <View style={[
                    styles.checkbox,
                    selectedTrackers.includes(tracker) && styles.checkboxSelected
                  ]}>
                    {selectedTrackers.includes(tracker) && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.checkboxLabel}>{tracker}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeCustomTracker(tracker)}
                >
                  <Text style={styles.removeButtonText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.addCustomSection}>
              <TextInput
                style={styles.textInput}
                placeholder="New tracker name"
                placeholderTextColor="#adb5bd"
                value={newTrackerName}
                onChangeText={setNewTrackerName}
                onSubmitEditing={addCustomTracker}
              />
              <TouchableOpacity style={styles.addButton} onPress={addCustomTracker}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
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
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#cdd6f4',
    textAlign: 'center',
    marginBottom: 20,
  },
  scrollContainer: {
    maxHeight: 400,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#cdd6f4',
    marginTop: 15,
    marginBottom: 10,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    flex: 1,
  },
  customTrackerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#89b4fa',
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#89b4fa',
  },
  checkmark: {
    color: '#1e1e2e',
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#cdd6f4',
  },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f38ba8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#1e1e2e',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addCustomSection: {
    flexDirection: 'row',
    marginTop: 15,
    marginBottom: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#45475a',
    color: '#cdd6f4',
    padding: 12,
    borderRadius: 6,
    marginRight: 10,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#a6e3a1',
    paddingHorizontal: 20,
    borderRadius: 6,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  cancelButton: {
    backgroundColor: '#f38ba8',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 6,
  },
  cancelButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#a6e3a1',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 6,
  },
  saveButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ConfigModal;
