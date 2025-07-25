// Constants and state management
const COOKIE_EXPIRATION_DAYS = 30;
const STATE_COOKIE_NAME = 'manaTracker_state';
const HISTORY_COOKIE_NAME = 'manaTracker_history';
const CONFIG_COOKIE_NAME = 'manaTracker_config';
const CUSTOM_TRACKERS_COOKIE_NAME = 'manaTracker_customTrackers';
const DIE_SIDES_COOKIE_NAME = 'manaTracker_dieSides';

// Default tracker types with colors
const DEFAULT_TRACKER_TYPES = {
    'White': {
        color: '#f9f9f9',
        textColor: '#1e1e2e'
    },
    'Blue': {
        color: '#74c0fc',
        textColor: '#1e1e2e'
    },
    'Black': {
        color: '#343a40',
        textColor: '#cdd6f4'
    },
    'Red': {
        color: '#fa5252',
        textColor: '#1e1e2e'
    },
    'Green': {
        color: '#51cf66',
        textColor: '#1e1e2e'
    },
    'Colorless': {
        color: '#adb5bd',
        textColor: '#1e1e2e'
    },
    'Storm': {
        color: '#be4bdb',
        textColor: '#1e1e2e'
    },
    'Discards': {
        color: '#fd7e14',
        textColor: '#1e1e2e'
    },
    'Pact Triggers': {
        color: '#9775fa',
        textColor: '#1e1e2e'
    }
};

// App state
let state = {};
let history = [];
let activeTrackers = [];
let customTrackers = [];
let dieSides = 6;

// DOM elements
const configModal = document.getElementById('configModal');
const historyModal = document.getElementById('historyModal');
const dieRollerModal = document.getElementById('dieRollerModal');
const trackerContainer = document.getElementById('trackerContainer');
const historyTableBody = document.getElementById('historyTableBody');

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadFromCookies();
    renderTrackers();
    setupEventListeners();
});

// Setup all event listeners
function setupEventListeners() {
    // Config button
    document.getElementById('configBtn').addEventListener('click', () => {
        showConfigModal();
    });

    // History button
    document.getElementById('historyBtn').addEventListener('click', () => {
        renderHistory();
        historyModal.style.display = 'block';
    });
    
    // Die Roller button
    document.getElementById('dieRollerBtn').addEventListener('click', () => {
        showDieRollerModal();
    });

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all counters and history?')) {
            resetAll();
        }
    });

    // Save config button
    document.getElementById('saveConfig').addEventListener('click', () => {
        saveConfig();
        configModal.style.display = 'none';
    });

    // Cancel config button
    document.getElementById('cancelConfig').addEventListener('click', () => {
        configModal.style.display = 'none';
    });

    // Close history button
    document.getElementById('closeHistory').addEventListener('click', () => {
        historyModal.style.display = 'none';
    });

    // Add custom tracker button
    document.getElementById('addCustomTracker').addEventListener('click', () => {
        const nameInput = document.getElementById('customTrackerName');
        const name = nameInput.value;
        
        if (addCustomTracker(name)) {
            nameInput.value = ''; // Clear input field on success
        }
    });
    
    // Add ability to press Enter in the custom tracker input field
    document.getElementById('customTrackerName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const name = e.target.value;
            if (addCustomTracker(name)) {
                e.target.value = ''; // Clear input field on success
            }
        }
    });
    
    // Die Roller modal buttons
    document.getElementById('rollDieBtn').addEventListener('click', rollDie);
    document.getElementById('closeDieRoller').addEventListener('click', () => {
        dieRollerModal.style.display = 'none';
        saveDieSettings();
    });
    
    // Number of sides input change
    document.getElementById('dieSides').addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        if (value < 2) e.target.value = 2;
        if (value > 100) e.target.value = 100;
        dieSides = parseInt(e.target.value);
        saveDieSettings();
    });
    
    // Close modals when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === configModal) {
            configModal.style.display = 'none';
        } else if (event.target === historyModal) {
            historyModal.style.display = 'none';
        } else if (event.target === dieRollerModal) {
            dieRollerModal.style.display = 'none';
            saveDieSettings();
        }
    });
}

// Load state from cookies
function loadFromCookies() {
    // Load active trackers
    const configCookie = getCookie(CONFIG_COOKIE_NAME);
    if (configCookie) {
        try {
            activeTrackers = JSON.parse(configCookie);
        } catch (e) {
            activeTrackers = Object.keys(DEFAULT_TRACKER_TYPES).slice(0, 5); // Default to first 5 trackers
        }
    } else {
        // Default to first 5 tracker types if no cookie exists
        activeTrackers = Object.keys(DEFAULT_TRACKER_TYPES).slice(0, 5);
    }

    // Load die sides
    const dieSidesCookie = getCookie(DIE_SIDES_COOKIE_NAME);
    if (dieSidesCookie) {
        try {
            dieSides = parseInt(dieSidesCookie);
            // Ensure it's within valid range
            if (isNaN(dieSides) || dieSides < 2) dieSides = 6;
            if (dieSides > 100) dieSides = 100;
        } catch (e) {
            dieSides = 6; // Default to 6 sides
        }
    }

    // Load state
    const stateCookie = getCookie(STATE_COOKIE_NAME);
    if (stateCookie) {
        try {
            state = JSON.parse(stateCookie);
        } catch (e) {
            initializeState();
        }
    } else {
        initializeState();
    }

    // Load history
    const historyCookie = getCookie(HISTORY_COOKIE_NAME);
    if (historyCookie) {
        try {
            history = JSON.parse(historyCookie);
            
            // Check if history entries need to be migrated to new format
            // (old format doesn't have stateSnapshot property)
            if (history.length > 0 && !history[0].hasOwnProperty('stateSnapshot')) {
                console.log("Migrating history data to new format");
                
                // Convert old history format to new format
                // Start with initial state of all zeros
                let currentState = {};
                Object.keys(DEFAULT_TRACKER_TYPES).forEach(type => {
                    currentState[type] = 0;
                });
                
                // Update each history entry with a full state snapshot
                history = history.map(entry => {
                    // Update the state for this tracker
                    if (currentState[entry.type] !== undefined) {
                        currentState[entry.type] = entry.newValue;
                    }
                    
                    // Create a new entry with the current state snapshot
                    return {
                        timestamp: entry.timestamp,
                        type: entry.type,
                        change: entry.change,
                        stateSnapshot: { ...currentState },
                        changes: [{ type: entry.type, change: entry.change }]
                    };
                });
                
                // Save the migrated history
                saveToCookies();
            }
            // Migrate entries that have stateSnapshot but not changes array
            else if (history.length > 0 && !history[0].hasOwnProperty('changes')) {
                console.log("Migrating history data to include changes array");
                
                // Add changes array to all entries
                history = history.map(entry => {
                    return {
                        ...entry,
                        changes: [{ type: entry.type, change: entry.change }]
                    };
                });
                
                // Save the migrated history
                saveToCookies();
            }
        } catch (e) {
            console.error("Error loading history:", e);
            history = [];
        }
    } else {
        history = [];
    }

    // Load custom trackers
    const customTrackersCookie = getCookie(CUSTOM_TRACKERS_COOKIE_NAME);
    if (customTrackersCookie) {
        try {
            customTrackers = JSON.parse(customTrackersCookie);
        } catch (e) {
            customTrackers = [];
        }
    } else {
        customTrackers = [];
    }
}

// Initialize the state object with default values
function initializeState() {
    state = {};
    Object.keys(DEFAULT_TRACKER_TYPES).forEach(type => {
        state[type] = 0;
    });
}

// Save all data to cookies
function saveToCookies() {
    setCookie(STATE_COOKIE_NAME, JSON.stringify(state), COOKIE_EXPIRATION_DAYS);
    setCookie(HISTORY_COOKIE_NAME, JSON.stringify(history), COOKIE_EXPIRATION_DAYS);
    setCookie(CONFIG_COOKIE_NAME, JSON.stringify(activeTrackers), COOKIE_EXPIRATION_DAYS);
    setCookie(CUSTOM_TRACKERS_COOKIE_NAME, JSON.stringify(customTrackers), COOKIE_EXPIRATION_DAYS);
    setCookie(DIE_SIDES_COOKIE_NAME, dieSides.toString(), COOKIE_EXPIRATION_DAYS);
}

// Render all active trackers
function renderTrackers() {
    trackerContainer.innerHTML = '';
    
    activeTrackers.forEach(type => {
        const tracker = createTrackerElement(type);
        trackerContainer.appendChild(tracker);
    });
    
    // Update button states after rendering
    updateAllButtonStates();
}

// Function to update button states for all trackers
function updateAllButtonStates() {
    activeTrackers.forEach(type => {
        updateButtonState(type);
    });
}

// Update the visual state of buttons based on counter value
function updateButtonState(type) {
    const value = state[type] || 0;
    // Use a CSS-safe class name (replace spaces with dashes)
    const cssClass = type.replace(/\s+/g, '-');
    const decBtn = document.querySelector(`.tracker.${cssClass} .counter-section .decrement`);
    
    if (decBtn) {
        if (value <= 0) {
            decBtn.classList.add('disabled');
        } else {
            decBtn.classList.remove('disabled');
        }
    }
}

// Create a single tracker element
function createTrackerElement(type) {
    const tracker = document.createElement('div');
    
    // Use a CSS-safe class name (replace spaces with dashes)
    const cssClass = type.replace(/\s+/g, '-');
    tracker.className = `tracker ${cssClass}`;
    
    // For custom trackers that don't have predefined styles, add a generic style
    if (!DEFAULT_TRACKER_TYPES[type]) {
        // Generate a deterministic color based on the name
        const color = generateColorFromName(type);
        tracker.style.backgroundColor = color;
        
        // Calculate text color based on background brightness
        const brightness = calculateBrightness(color);
        tracker.style.color = brightness > 128 ? '#1e1e2e' : '#cdd6f4';
    }
    
    const label = document.createElement('div');
    label.className = 'tracker-label';
    label.textContent = type;
    
    // Create a container for the counter section
    const counterSection = document.createElement('div');
    counterSection.className = 'counter-section';
    
    // Create decrement button (full left side)
    const decBtn = document.createElement('button');
    decBtn.className = 'decrement';
    decBtn.textContent = '-';
    
    // Set initial disabled state
    if ((state[type] || 0) <= 0) {
        decBtn.classList.add('disabled');
    }
    
    decBtn.addEventListener('click', () => {
        // Check if value is already at zero
        if ((state[type] || 0) <= 0) {
            // Apply shake animation
            const tracker = document.querySelector(`.tracker.${CSS.escape(type)}`);
            if (tracker) {
                tracker.classList.add('shake');
                setTimeout(() => tracker.classList.remove('shake'), 300);
            }
            return;
        }
        
        updateCounter(type, -1);
    });
    
    // Create counter value display (centered)
    const value = document.createElement('div');
    value.className = 'counter-value';
    value.id = `${type}-value`;
    value.textContent = state[type] || 0;
    
    // Create increment button (full right side)
    const incBtn = document.createElement('button');
    incBtn.className = 'increment';
    incBtn.textContent = '+';
    incBtn.addEventListener('click', () => updateCounter(type, 1));
    
    // Add all elements to the counter section
    counterSection.appendChild(decBtn);
    counterSection.appendChild(value);
    counterSection.appendChild(incBtn);
    
    // Add label and counter section to the tracker
    tracker.appendChild(label);
    tracker.appendChild(counterSection);
    
    return tracker;
}

// Update a counter value
function updateCounter(type, change) {
    // Initialize to 0 if undefined
    if (state[type] === undefined) {
        state[type] = 0;
    }
    
    // Update the state
    const oldValue = state[type];
    const newValue = state[type] + change;
    
    // Prevent negative values for all trackers
    if (newValue < 0) {
        // Don't update if it would go below zero
        return;
    }
    
    // Update the state with the new value
    state[type] = newValue;
    
    // Update display
    const valueElement = document.getElementById(`${type}-value`);
    if (valueElement) {
        valueElement.textContent = state[type];
    }
    
    // Update button state
    updateButtonState(type);
    
    // Add to history
    addToHistory(type, change, state[type]);
    
    // Save to cookies
    saveToCookies();
}

// Add an entry to the history
function addToHistory(type, change, newValue) {
    const now = new Date();
    const entry = {
        timestamp: now.toISOString(),
        type: type,
        change: change,
        // Store a snapshot of all current values
        stateSnapshot: { ...state },
        // Store changes for combined entries
        changes: [{ type, change }]
    };
    
    // Try to combine with previous entry if it's recent enough (within 3 seconds)
    if (shouldCombineWithPreviousEntry(type, now)) {
        combineWithPreviousEntry(entry);
    } else {
        // Add as a new entry
        history.push(entry);
    }
    
    // Keep history size reasonable (max 100 entries)
    if (history.length > 100) {
        history.shift();
    }
}

// Check if the new entry should be combined with the previous entry
function shouldCombineWithPreviousEntry(type, now) {
    if (history.length === 0) {
        return false;
    }
    
    const lastEntry = history[history.length - 1];
    const lastTimestamp = new Date(lastEntry.timestamp);
    
    // Calculate time difference in milliseconds
    const timeDiff = now.getTime() - lastTimestamp.getTime();
    
    // Combine if less than 3 seconds apart (3000 milliseconds)
    return timeDiff <= 3000;
}

// Combine the new entry with the previous one
function combineWithPreviousEntry(newEntry) {
    const lastEntry = history[history.length - 1];
    
    // Add the new change to the previous entry's changes array
    lastEntry.changes.push(...newEntry.changes);
    
    // Update the state snapshot with the latest values
    lastEntry.stateSnapshot = { ...newEntry.stateSnapshot };
    
    // Keep the original timestamp
}

// Show the configuration modal
function showConfigModal() {
    // Update checkbox states based on active trackers
    const checkboxes = document.querySelectorAll('.checkbox-group input');
    checkboxes.forEach(checkbox => {
        const type = checkbox.getAttribute('data-type');
        checkbox.checked = activeTrackers.includes(type);
    });
    
    // Render custom trackers in the config modal
    renderCustomTrackers();
    
    configModal.style.display = 'block';
}

// Save the configuration
function saveConfig() {
    // Get all checkboxes from both built-in and custom trackers
    const allCheckboxes = [
        ...document.querySelectorAll('.checkbox-group input'),
        ...document.querySelectorAll('.custom-tracker-item input')
    ];
    
    const selectedTrackers = [];
    
    allCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            selectedTrackers.push(checkbox.getAttribute('data-type'));
        }
    });
    
    // Ensure at least one tracker is selected
    if (selectedTrackers.length === 0) {
        alert('Please select at least one tracker');
        return;
    }
    
    activeTrackers = selectedTrackers;
    saveToCookies();
    renderTrackers();
    // Button states are updated in renderTrackers via updateAllButtonStates
}

// Add a new custom tracker
function addCustomTracker(name) {
    // Validate name
    if (!name || name.trim() === '') {
        return false;
    }
    
    name = name.trim();
    
    // Check if name already exists (case-insensitive)
    const allTrackerNames = [...Object.keys(DEFAULT_TRACKER_TYPES), ...customTrackers];
    if (allTrackerNames.some(trackerName => trackerName.toLowerCase() === name.toLowerCase())) {
        alert(`A tracker with the name "${name}" already exists!`);
        return false;
    }
    
    // Add to custom trackers array
    customTrackers.push(name);
    
    // Save to cookies
    saveToCookies();
    
    // Update the UI
    renderCustomTrackers();
    
    return true;
}

// Remove a custom tracker
function removeCustomTracker(name) {
    // Remove from active trackers if it's active
    if (activeTrackers.includes(name)) {
        activeTrackers = activeTrackers.filter(tracker => tracker !== name);
    }
    
    // Remove from custom trackers array
    customTrackers = customTrackers.filter(tracker => tracker !== name);
    
    // Save to cookies
    saveToCookies();
    
    // Update the UI
    renderCustomTrackers();
}

// Render the custom trackers in the config modal
function renderCustomTrackers() {
    const customTrackersContainer = document.getElementById('customTrackers');
    customTrackersContainer.innerHTML = '';
    
    if (customTrackers.length === 0) {
        customTrackersContainer.innerHTML = '<div class="empty-custom-trackers">No custom trackers added yet.</div>';
        return;
    }
    
    customTrackers.forEach(trackerName => {
        const item = document.createElement('div');
        item.className = 'custom-tracker-item';
        
        const label = document.createElement('label');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('data-type', trackerName);
        checkbox.checked = activeTrackers.includes(trackerName);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = trackerName;
        
        const removeButton = document.createElement('button');
        removeButton.className = 'remove-custom-tracker';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `Remove ${trackerName}`);
        removeButton.addEventListener('click', () => removeCustomTracker(trackerName));
        
        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        item.appendChild(label);
        item.appendChild(removeButton);
        
        customTrackersContainer.appendChild(item);
    });
}

// Render the history table
function renderHistory() {
    // Clear existing table content
    const historyTableHead = document.getElementById('historyTableHead');
    historyTableHead.innerHTML = '';
    historyTableBody.innerHTML = '';
    
    // Create header row
    const headerRow = document.createElement('tr');
    
    // Time column
    const timeHeader = document.createElement('th');
    timeHeader.textContent = 'Time';
    headerRow.appendChild(timeHeader);
    
    // Action column
    const actionHeader = document.createElement('th');
    actionHeader.textContent = 'Action';
    headerRow.appendChild(actionHeader);
    
    // Add a column for each active tracker
    activeTrackers.forEach(tracker => {
        const trackerHeader = document.createElement('th');
        trackerHeader.textContent = tracker;
        headerRow.appendChild(trackerHeader);
    });
    
    historyTableHead.appendChild(headerRow);
    
    // Display history from oldest (top) to newest (bottom)
    const sortedHistory = [...history];
    
    // Create a row for each history entry
    sortedHistory.forEach(entry => {
        const row = document.createElement('tr');
        
        // Time cell
        const timeCell = document.createElement('td');
        timeCell.textContent = formatDate(new Date(entry.timestamp));
        row.appendChild(timeCell);
        
        // Action cell (shows what changed)
        const actionCell = document.createElement('td');
        
        // Handle combined entries
        if (entry.changes && entry.changes.length > 0) {
            // Group changes by type
            const changesByType = {};
            entry.changes.forEach(change => {
                if (!changesByType[change.type]) {
                    changesByType[change.type] = 0;
                }
                changesByType[change.type] += change.change;
            });
            
            // Create a string showing all changes
            const changeTexts = [];
            for (const [type, totalChange] of Object.entries(changesByType)) {
                const changeText = totalChange > 0 ? `+${totalChange}` : totalChange;
                const cssClass = totalChange > 0 ? 'positive' : 'negative';
                changeTexts.push(`<div class="combined-changes"><span class="changed-type">${type}</span>: <span class="change-value ${cssClass}">${changeText}</span></div>`);
            }
            
            // Add a special class if there are multiple changes
            if (Object.keys(changesByType).length > 1) {
                actionCell.classList.add('action-cell-combined');
            }
            
            actionCell.innerHTML = changeTexts.join('');
        } else {
            // Handle legacy entries for backward compatibility
            const changeText = entry.change > 0 ? `+${entry.change}` : entry.change;
            actionCell.innerHTML = `<span class="changed-type">${entry.type}</span>: <span class="change-value ${entry.change > 0 ? 'positive' : 'negative'}">${changeText}</span>`;
        }
        
        row.appendChild(actionCell);
        
        // Add a cell for each active tracker with its value at that point in history
        activeTrackers.forEach(tracker => {
            const valueCell = document.createElement('td');
            
            // Get the value for this tracker from the state snapshot
            const value = entry.stateSnapshot[tracker] !== undefined ? entry.stateSnapshot[tracker] : 0;
            valueCell.textContent = value;
            
            // Highlight the cell if it's one of the types that changed
            if (entry.changes && entry.changes.some(change => change.type === tracker)) {
                valueCell.classList.add('changed-cell');
            } else if (tracker === entry.type) { 
                // For backward compatibility with old history entries
                valueCell.classList.add('changed-cell');
            }
            
            row.appendChild(valueCell);
        });
        
        historyTableBody.appendChild(row);
    });
    
    // Auto-scroll to the bottom to show the latest entry
    setTimeout(() => {
        const historyContainer = document.querySelector('.history-container');
        if (historyContainer) {
            historyContainer.scrollTop = historyContainer.scrollHeight;
        }
    }, 100);
}

// Reset all counters and history
function resetAll() {
    initializeState();
    history = [];
    saveToCookies();
    renderTrackers();
    // Button states are updated in renderTrackers via updateAllButtonStates
}

// Format a date object to a readable string
function formatDate(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Cookie utilities
function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = `${name}=`;
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1, c.length);
        }
        if (c.indexOf(nameEQ) === 0) {
            return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
    }
    return null;
}

// Generate a deterministic color from a name
function generateColorFromName(name) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Create a vibrant HSL color with good saturation and lightness
    const h = hash % 360;
    const s = 70 + (hash % 20); // 70-90% saturation
    const l = 45 + (hash % 15); // 45-60% lightness
    
    return `hsl(${h}, ${s}%, ${l}%)`;
}

// Calculate the perceived brightness of a color (for determining text color)
function calculateBrightness(color) {
    // For HSL colors, we can just use the lightness value
    if (color.startsWith('hsl')) {
        // Extract the lightness value
        const match = color.match(/hsl\(\s*\d+\s*,\s*\d+%\s*,\s*(\d+)%\s*\)/);
        if (match && match[1]) {
            return parseInt(match[1]) * 2.55; // Convert from 0-100 to 0-255
        }
    }
    
    // For hex or other colors, convert to RGB and use the brightness formula
    // This is a simplified implementation, might not work for all color formats
    return 127; // Default middle brightness
}

// Die roller functions
function showDieRollerModal() {
    // Update the input field with current sides
    const dieSidesInput = document.getElementById('dieSides');
    dieSidesInput.value = dieSides;
    
    // Show the modal
    dieRollerModal.style.display = 'block';
}

function rollDie() {
    const resultElement = document.getElementById('dieResult');
    const sides = parseInt(document.getElementById('dieSides').value);
    
    // Add animation class
    resultElement.classList.add('rolling');
    resultElement.textContent = '?';
    
    // Generate random result after a short delay (for animation effect)
    setTimeout(() => {
        const result = Math.floor(Math.random() * sides) + 1;
        resultElement.textContent = result;
        
        // Remove the animation class after it completes
        setTimeout(() => {
            resultElement.classList.remove('rolling');
        }, 400);
    }, 150);
}

function saveDieSettings() {
    dieSides = parseInt(document.getElementById('dieSides').value);
    // Ensure it's within valid range
    if (isNaN(dieSides) || dieSides < 2) dieSides = 6;
    if (dieSides > 100) dieSides = 100;
    
    setCookie(DIE_SIDES_COOKIE_NAME, dieSides.toString(), COOKIE_EXPIRATION_DAYS);
}
