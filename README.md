# NewClash

A modern, premium Clash client built with Electron, React, and TailwindCSS.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 🎨 **Premium UI**: Glassmorphism, smooth animations, and dark mode.
- ⚡ **Fast**: Built on Vite and React.
- 🛠 **Configurable**: Manage proxies, profiles, and settings easily.
- 📊 **Insightful**: Real-time traffic monitoring and logs.

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm or pnpm

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Start the development server with hot-reload:
```bash
npm run dev
```

### Build

Build the application for production:
```bash
npm run build
```

## Project Structure

- `electron/`: Main process code and preload scripts.
- `src/`: Renderer process code (React).
  - `components/`: Reusable UI components.
  - `pages/`: Application views (Dashboard, Proxies, etc.).
  - `lib/`: Utilities.

## License

MIT
