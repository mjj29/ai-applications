import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const STORAGE_KEYS = {
  STATE: 'manaTracker_state',
  HISTORY: 'manaTracker_history',
  CONFIG: 'manaTracker_config',
  CUSTOM_TRACKERS: 'manaTracker_customTrackers',
  DIE_SIDES: 'manaTracker_dieSides',
};

export const StorageService = {
  // Save data to AsyncStorage
  async saveData(key, data) {
    try {
      const jsonValue = JSON.stringify(data);
      await AsyncStorage.setItem(key, jsonValue);
    } catch (error) {
      console.error(`Error saving data for key ${key}:`, error);
    }
  },

  // Load data from AsyncStorage
  async loadData(key, defaultValue = null) {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue != null ? JSON.parse(jsonValue) : defaultValue;
    } catch (error) {
      console.error(`Error loading data for key ${key}:`, error);
      return defaultValue;
    }
  },

  // Clear all data
  async clearAll() {
    try {
      await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    } catch (error) {
      console.error('Error clearing all data:', error);
    }
  },

  // Storage key getters
  getStateKey: () => STORAGE_KEYS.STATE,
  getHistoryKey: () => STORAGE_KEYS.HISTORY,
  getConfigKey: () => STORAGE_KEYS.CONFIG,
  getCustomTrackersKey: () => STORAGE_KEYS.CUSTOM_TRACKERS,
  getDieSidesKey: () => STORAGE_KEYS.DIE_SIDES,
};
