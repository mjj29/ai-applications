#!/bin/bash

# Mana Tracker Android Build Script
# This script helps you build and install the Android app

echo "🎯 Mana Tracker - Android Build Script"
echo "======================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not available. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are available"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

echo "✅ Dependencies are installed"

echo ""
echo "Choose a build option:"
echo "1) Start development server (Expo Go)"
echo "2) Build APK with EAS Build (requires Expo account)"
echo "3) Build locally (requires Android Studio setup)"
echo "4) Just install dependencies and exit"

read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        echo "🚀 Starting development server..."
        echo "Use the Expo Go app on your phone to scan the QR code"
        npx expo start
        ;;
    2)
        echo "🏗️  Building APK with EAS Build..."
        echo "Note: This requires an Expo account and internet connection"
        echo "The APK will be available for download from the EAS dashboard"
        npx eas build --platform android --profile preview
        ;;
    3)
        echo "🏗️  Building locally..."
        echo "Note: This requires Android Studio and Android SDK to be set up"
        npx expo run:android
        ;;
    4)
        echo "✅ Dependencies installed. You can now:"
        echo "   - Run 'npm start' to start development server"
        echo "   - Run 'npm run build:android' to build APK"
        echo "   - Run 'npm run build:local' to build locally"
        ;;
    *)
        echo "❌ Invalid choice. Please run the script again."
        exit 1
        ;;
esac

echo ""
echo "📱 Once you have an APK file:"
echo "   1. Enable 'Install from unknown sources' in Android settings"
echo "   2. Transfer the APK to your phone"
echo "   3. Tap the APK file to install"
echo "   4. Enjoy tracking your mana! 🎮"
