# Quick Start Guide

## 🚀 Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm start
   ```

3. **Test the app:**
   - Install "Expo Go" app on your Android phone from Google Play Store
   - Scan the QR code shown in the terminal with Expo Go
   - The app will load on your phone for testing

## 📱 Building APK for Installation

### Easy Method (using build script):
```bash
./build.sh
```

### Manual Method:
```bash
# Build APK (requires Expo account)
npm run build:android

# Or build locally (requires Android Studio)
npm run build:local
```

## 🎯 Features Implemented

- ✅ Mana tracking (White, Blue, Black, Red, Green, Colorless)
- ✅ Special counters (Storm, Discards, Pact Triggers)
- ✅ Custom tracker creation
- ✅ **Default setup** - starts with basic mana colors enabled
- ✅ Persistent storage (data survives app restart)
- ✅ **Smart history tracking** - collapses rapid changes into single entries
- ✅ Die roller with customizable sides
- ✅ **Selective reset** - reset counters while keeping configuration
- ✅ Dark theme optimized for mobile
- ✅ Large touch targets for easy use during games
- ✅ Shake animation when trying to go below zero

## 🔧 Troubleshooting

**Metro bundler cache issues:**
```bash
npx expo start --clear
```

**Dependency issues:**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Can't connect to development server:**
- Make sure your phone and computer are on the same WiFi network
- Try using tunnel mode: `npx expo start --tunnel`

## 📁 Project Structure

```
tracker-app/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── TrackerComponent.js
│   │   ├── ConfigModal.js
│   │   ├── HistoryModal.js
│   │   └── DieRollerModal.js
│   ├── screens/            # App screens
│   │   └── MainScreen.js
│   └── utils/              # Utilities
│       ├── storage.js      # AsyncStorage wrapper
│       └── constants.js    # App constants and colors
├── App.js                  # Root component
├── app.json               # App configuration
├── eas.json              # Build configuration
└── build.sh              # Build helper script
```
