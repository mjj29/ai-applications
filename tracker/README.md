# Mana Tracker

A pure client-side webapp for tracking mana and other resources in physical card games like Magic: The Gathering.

## Features

- Track different types of mana: White, Blue, Black, Red, Green, Colorless
- Track other quantities like Storm count, Discards, and Pact Triggers
- Configurable trackers - choose only what you need for your current game
- Big, easy to press buttons optimized for mobile use
- Persistent storage using browser cookies - values don't reset on refresh
- History tracking of all changes during your game
- Fully client-side - no server required, works offline

## Usage

1. **Open index.html in any modern browser** - works best on mobile devices
2. **Configure your trackers** - Click the "Configure" button to select which resources you want to track
3. **Track resources during your game** - Use the + and - buttons to adjust values
4. **View history** - Click the "History" button to see a log of all changes
5. **Reset** - Click "Reset All" to start a new game (resets all counters and history)

## Deployment

Since this is a pure client-side application, you can:

1. Simply open the index.html file in a browser
2. Host the files on any static web hosting service
3. Use GitHub Pages or similar services for free hosting

## Browser Compatibility

This application works on all modern browsers that support:
- JavaScript ES6+
- CSS Grid Layout
- Local Storage and Cookies

## Development

This project uses vanilla HTML, CSS, and JavaScript with no external dependencies.

To modify:
- `index.html` - Main structure
- `styles.css` - All styling and layout
- `script.js` - All application logic and functionality
