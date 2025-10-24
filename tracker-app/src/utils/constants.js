// Default tracker types with colors
export const DEFAULT_TRACKER_TYPES = {
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

// Color generation for custom trackers
export const generateColorFromName = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Convert to HSL for better color variety
  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash) % 40); // 60-100%
  const lightness = 45 + (Math.abs(hash) % 30); // 45-75%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Calculate brightness for text color selection
export const calculateBrightness = (color) => {
  // Simple brightness calculation for HSL colors
  if (color.includes('hsl')) {
    const lightness = parseInt(color.match(/(\d+)%\)/)[1]);
    return lightness * 2.55; // Convert to 0-255 scale
  }
  
  // For hex colors
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
};
