# Mana Tracker - Android App

A React Native/Expo mobile application for tracking mana and other resources in physical card games like Magic: The Gathering.

## Features

- Track different types of mana: White, Blue, Black, Red, Green, Colorless
- Track other quantities like Storm count, Discards, and Pact Triggers
- Custom trackers - add your own resource types
- **Default configuration** - starts with basic mana colors (White, Blue, Black, Red, Green) enabled
- Large, touch-friendly buttons optimized for mobile use
- Persistent storage using AsyncStorage - values don't reset on app restart
- **Smart history tracking** - changes made within 2 seconds are collapsed into single entries
- Die roller with customizable number of sides
- **Selective reset** - reset counters and history while keeping your tracker configuration
- Dark theme optimized for mobile gaming

## Development Setup

### Prerequisites

1. Install Node.js (18 or later)
2. Install Expo CLI: `npm install -g @expo/cli`
3. Install EAS CLI: `npm install -g eas-cli`

### Local Development

1. Clone/navigate to the project directory
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npx expo start
   ```

4. Use the Expo Go app on your phone to scan the QR code and test the app

## Building for Android

### Quick Start

Run the build script for an interactive setup:
```bash
chmod +x build.sh
./build.sh
```

### Option 1: Build APK with EAS Build (Recommended)

1. Create an Expo account at https://expo.dev if you don't have one
2. Login to EAS:
   ```bash
   npx eas login
   ```

3. Configure the project:
   ```bash
   npx eas build:configure
   ```

4. Build the APK:
   ```bash
   npm run build:android
   # or
   npx eas build --platform android --profile preview
   ```

5. Download the APK from the EAS dashboard and install it on your phone

### Option 2: Local Android Build

1. Install Android Studio and set up Android SDK
2. Create a local build:
   ```bash
   npm run build:local
   # or
   npx expo run:android
   ```

### Option 3: Development with Expo Go

1. Install Expo Go app on your phone from Google Play Store
2. Start the development server:
   ```bash
   npm start
   ```
3. Scan the QR code with Expo Go to test the app

## Installing on Your Phone

### From APK File:
1. Enable "Install from unknown sources" in your Android settings
2. Download the APK file to your phone
3. Tap the APK file to install
4. Grant any necessary permissions

### Using ADB (if connected to computer):
```bash
adb install path/to/your/app.apk
```

## Usage

1. **Configure trackers**: Tap "Configure" to select which resources you want to track
2. **Track resources**: Use the + and - buttons to adjust values during your game
3. **View history**: Tap "History" to see a log of all changes
4. **Roll dice**: Use the die roller for random number generation
5. **Reset**: Tap "Reset" to start a new game (resets all counters and history)

## Project Structure

```
src/
├── components/
│   ├── TrackerComponent.js     # Individual tracker with +/- buttons
│   ├── ConfigModal.js          # Configuration modal for selecting trackers
│   ├── HistoryModal.js         # History display modal
│   └── DieRollerModal.js       # Die rolling functionality
├── screens/
│   └── MainScreen.js           # Main app screen
└── utils/
    ├── storage.js              # AsyncStorage wrapper
    └── constants.js            # Color definitions and utilities
```

## Customization

- **Colors**: Modify `src/utils/constants.js` to change tracker colors
- **Default trackers**: Edit `DEFAULT_TRACKER_TYPES` in constants.js
- **Styling**: Update styles in individual component files

## Troubleshooting

- **Build errors**: Make sure all dependencies are installed with `npm install`
- **Storage issues**: Clear app data in Android settings if counters aren't persisting
- **Performance**: The app is optimized for mobile use with efficient rendering

## License

This project is open source and available under the MIT License.
