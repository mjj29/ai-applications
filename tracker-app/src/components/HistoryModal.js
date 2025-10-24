import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
} from 'react-native';

const HistoryModal = ({ visible, onClose, history, activeTrackers }) => {
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const renderHistoryItem = ({ item, index }) => {
    const changes = item.changes || [{ type: item.type, change: item.change }];
    
    return (
      <View style={styles.historyItem}>
        <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
        <View style={styles.changesContainer}>
          {changes.map((change, changeIndex) => (
            <Text key={changeIndex} style={styles.changeText}>
              {change.type}: {change.change > 0 ? '+' : ''}{change.change}
            </Text>
          ))}
        </View>
        {item.stateSnapshot && (
          <View style={styles.stateSnapshot}>
            {activeTrackers.map(tracker => (
              <Text key={tracker} style={styles.stateItem}>
                {tracker}: {item.stateSnapshot[tracker] || 0}
              </Text>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={styles.headerText}>Time</Text>
      <Text style={styles.headerText}>Changes</Text>
      <Text style={styles.headerText}>State</Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>History</Text>
          
          {history.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No history entries yet</Text>
            </View>
          ) : (
            <FlatList
              data={[...history].reverse()} // Show most recent first
              renderItem={renderHistoryItem}
              keyExtractor={(item, index) => `${item.timestamp}-${index}`}
              style={styles.historyList}
              ListHeaderComponent={renderHeader}
              showsVerticalScrollIndicator={false}
            />
          )}

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
    width: '95%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#cdd6f4',
    textAlign: 'center',
    marginBottom: 20,
  },
  headerContainer: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#45475a',
    marginBottom: 10,
  },
  headerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#89b4fa',
    textAlign: 'center',
  },
  historyList: {
    maxHeight: 400,
  },
  historyItem: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#45475a',
    alignItems: 'flex-start',
  },
  timestamp: {
    flex: 1,
    fontSize: 12,
    color: '#cdd6f4',
    textAlign: 'center',
  },
  changesContainer: {
    flex: 1,
    alignItems: 'center',
  },
  changeText: {
    fontSize: 12,
    color: '#cdd6f4',
    textAlign: 'center',
  },
  stateSnapshot: {
    flex: 1,
    alignItems: 'center',
  },
  stateItem: {
    fontSize: 10,
    color: '#a6adc8',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  emptyText: {
    fontSize: 16,
    color: '#a6adc8',
    textAlign: 'center',
  },
  closeButton: {
    backgroundColor: '#89b4fa',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 6,
    alignSelf: 'center',
    marginTop: 20,
  },
  closeButtonText: {
    color: '#1e1e2e',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default HistoryModal;
