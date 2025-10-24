import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native';

import TrackerComponent from '../components/TrackerComponent';
import ConfigModal from '../components/ConfigModal';
import HistoryModal from '../components/HistoryModal';
import DieRollerModal from '../components/DieRollerModal';
import { StorageService } from '../utils/storage';
import { DEFAULT_TRACKER_TYPES } from '../utils/constants';

const MainScreen = () => {
  const [state, setState] = useState({});
  const [history, setHistory] = useState([]);
  const [activeTrackers, setActiveTrackers] = useState(['White', 'Blue', 'Black', 'Red', 'Green']); // Default trackers
  const [customTrackers, setCustomTrackers] = useState([]);
  const [dieSides, setDieSides] = useState(6);
  const [isLoaded, setIsLoaded] = useState(false); // Track if initial load is complete
  
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [dieRollerModalVisible, setDieRollerModalVisible] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load other data first to know what trackers exist
      const savedHistory = await StorageService.loadData(StorageService.getHistoryKey(), []);
      const savedActiveTrackers = await StorageService.loadData(StorageService.getConfigKey(), ['White', 'Blue', 'Black', 'Red', 'Green']); // Default to basic mana colors
      const savedCustomTrackers = await StorageService.loadData(StorageService.getCustomTrackersKey(), []);
      const savedDieSides = await StorageService.loadData(StorageService.getDieSidesKey(), 6);

      // Load state
      const savedState = await StorageService.loadData(StorageService.getStateKey(), {});
      
      // Initialize state with default values for ALL trackers (built-in + custom)
      const initializedState = {};
      
      // Initialize built-in trackers
      Object.keys(DEFAULT_TRACKER_TYPES).forEach(type => {
        initializedState[type] = savedState[type] !== undefined ? savedState[type] : 0;
      });
      
      // Initialize custom trackers
      savedCustomTrackers.forEach(type => {
        initializedState[type] = savedState[type] !== undefined ? savedState[type] : 0;
      });
      
      setState(initializedState);

      console.log('Loaded data:', {
        state: Object.keys(initializedState).length + ' trackers',
        history: savedHistory.length + ' entries',
        activeTrackers: savedActiveTrackers,
        customTrackers: savedCustomTrackers,
        dieSides: savedDieSides
      });

      setHistory(savedHistory);
      setActiveTrackers(savedActiveTrackers);
      setCustomTrackers(savedCustomTrackers);
      setDieSides(savedDieSides);
      setIsLoaded(true); // Mark as loaded
    } catch (error) {
      console.error('Error loading data:', error);
      // Set defaults if loading fails
      setActiveTrackers(['White', 'Blue', 'Black', 'Red', 'Green']);
      setCustomTrackers([]);
      setHistory([]);
      setDieSides(6);
      
      const defaultState = {};
      Object.keys(DEFAULT_TRACKER_TYPES).forEach(type => {
        defaultState[type] = 0;
      });
      setState(defaultState);
      setIsLoaded(true); // Mark as loaded even on error
    }
  };

  const saveData = async (overrideState = null, overrideHistory = null) => {
    try {
      const stateToSave = overrideState !== null ? overrideState : state;
      const historyToSave = overrideHistory !== null ? overrideHistory : history;
      
      await Promise.all([
        StorageService.saveData(StorageService.getStateKey(), stateToSave),
        StorageService.saveData(StorageService.getHistoryKey(), historyToSave),
        StorageService.saveData(StorageService.getConfigKey(), activeTrackers),
        StorageService.saveData(StorageService.getCustomTrackersKey(), customTrackers),
        StorageService.saveData(StorageService.getDieSidesKey(), dieSides),
      ]);
      console.log('Data saved:', {
        state: Object.keys(stateToSave).length + ' trackers',
        history: historyToSave.length + ' entries',
        activeTrackers: activeTrackers.length + ' active',
        customTrackers: customTrackers.length + ' custom'
      });
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

  useEffect(() => {
    // Only save data after initial load is complete
    if (isLoaded) {
      saveData();
    }
  }, [state, history, activeTrackers, customTrackers, dieSides, isLoaded]);

  const updateCounter = (type, change) => {
    const oldValue = state[type] || 0;
    const newValue = Math.max(0, oldValue + change);

    // Update state
    setState(prev => ({
      ...prev,
      [type]: newValue
    }));

    // Check if we can combine this change with the most recent history entry
    const now = Date.now();
    const COLLAPSE_WINDOW = 2000; // 2 seconds
    
    setHistory(prev => {
      const lastEntry = prev[prev.length - 1];
      
      // If there's a recent entry within the collapse window (regardless of tracker type)
      if (lastEntry && (now - lastEntry.timestamp) < COLLAPSE_WINDOW) {
        
        // Check if this tracker is already in the changes array
        const existingChangeIndex = lastEntry.changes.findIndex(c => c.type === type);
        
        let updatedChanges;
        if (existingChangeIndex >= 0) {
          // Update existing change for this tracker type
          updatedChanges = [...lastEntry.changes];
          updatedChanges[existingChangeIndex] = {
            type,
            change: updatedChanges[existingChangeIndex].change + change
          };
        } else {
          // Add new change to the existing entry
          updatedChanges = [...lastEntry.changes, { type, change }];
        }
        
        // Update the existing entry
        const updatedEntry = {
          ...lastEntry,
          timestamp: now, // Update to latest timestamp
          type: updatedChanges.length === 1 ? updatedChanges[0].type : 'Multiple', // Keep original if single, or mark as multiple
          change: updatedChanges.length === 1 ? updatedChanges[0].change : 0, // Legacy field
          stateSnapshot: {
            ...state,
            [type]: newValue
          },
          changes: updatedChanges
        };
        
        // Replace the last entry with the updated one
        return [...prev.slice(0, -1), updatedEntry];
      } else {
        // Create a new history entry
        const historyEntry = {
          timestamp: now,
          type,
          change,
          stateSnapshot: {
            ...state,
            [type]: newValue
          },
          changes: [{ type, change }]
        };
        
        return [...prev, historyEntry];
      }
    });
  };

  const handleConfigSave = (newActiveTrackers, newCustomTrackers) => {
    setActiveTrackers(newActiveTrackers);
    setCustomTrackers(newCustomTrackers);

    // Initialize state for new custom trackers
    const newState = { ...state };
    newCustomTrackers.forEach(tracker => {
      if (newState[tracker] === undefined) {
        newState[tracker] = 0;
      }
    });
    setState(newState);
  };

  const performReset = () => {
    // Create reset state
    const resetState = {};
    [...Object.keys(DEFAULT_TRACKER_TYPES), ...customTrackers].forEach(type => {
      resetState[type] = 0;
    });
    
    const emptyHistory = [];
    
    // Update state immediately
    setState(resetState);
    setHistory(emptyHistory);
    
    // Save to storage
    StorageService.saveData(StorageService.getStateKey(), resetState);
    StorageService.saveData(StorageService.getHistoryKey(), emptyHistory);
  };

  const handleReset = () => {
    // Use Alert for mobile, confirm for web
    if (Alert && Alert.alert) {
      Alert.alert(
        'Reset Counters',
        'Are you sure you want to reset all counters and history? (This will keep your tracker configuration)',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: performReset }
        ]
      );
    } else {
      // Web fallback
      const confirmed = confirm('Are you sure you want to reset all counters and history? (This will keep your tracker configuration)');
      if (confirmed) {
        performReset();
      }
    }
  };

  const handleDieSidesChange = (newDieSides) => {
    setDieSides(newDieSides);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e1e2e" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Mana Tracker</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.headerButton, styles.configButton]}
          onPress={() => setConfigModalVisible(true)}
        >
          <Text style={styles.headerButtonText}>Configure</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.headerButton, styles.historyButton]}
          onPress={() => setHistoryModalVisible(true)}
        >
          <Text style={styles.headerButtonText}>History</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.headerButton, styles.dieRollerButton]}
          onPress={() => setDieRollerModalVisible(true)}
        >
          <Text style={styles.headerButtonText}>Roll Die</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.headerButton, styles.resetButton]}
          onPress={handleReset}
        >
          <Text style={styles.headerButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.trackersContainer}>
        {activeTrackers.map(type => (
          <TrackerComponent
            key={type}
            type={type}
            value={state[type] || 0}
            onIncrement={() => updateCounter(type, 1)}
            onDecrement={() => updateCounter(type, -1)}
          />
        ))}
        
        {activeTrackers.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No trackers configured.{'\n'}
              Tap "Configure" to add trackers.
            </Text>
          </View>
        )}
      </ScrollView>

      <ConfigModal
        visible={configModalVisible}
        onClose={() => setConfigModalVisible(false)}
        activeTrackers={activeTrackers}
        customTrackers={customTrackers}
        onSave={handleConfigSave}
      />

      <HistoryModal
        visible={historyModalVisible}
        onClose={() => setHistoryModalVisible(false)}
        history={history}
        activeTrackers={activeTrackers}
      />

      <DieRollerModal
        visible={dieRollerModalVisible}
        onClose={() => setDieRollerModalVisible(false)}
        dieSides={dieSides}
        onDieSidesChange={handleDieSidesChange}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e2e',
  },
  header: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#cdd6f4',
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingBottom: 15,
    gap: 8,
  },
  headerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  configButton: {
    backgroundColor: '#89b4fa',
  },
  historyButton: {
    backgroundColor: '#fab387',
  },
  dieRollerButton: {
    backgroundColor: '#a6e3a1',
  },
  resetButton: {
    backgroundColor: '#f38ba8',
  },
  headerButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 12,
  },
  trackersContainer: {
    flex: 1,
    paddingHorizontal: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#a6adc8',
    textAlign: 'center',
    lineHeight: 26,
  },
});

export default MainScreen;
