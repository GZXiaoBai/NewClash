# NewClash Development Guide

## Project Structure
- `electron/`: Main process code (kernel manager, store, system proxy).
- `src/`: Renderer process (React, Pages, Components).
- `dist-electron/`: Compiled main process files.

## Architecture
- **KernelManager (`electron/kernel.ts`)**: Manages the Clash binary using `child_process`.
  - **SetUID Mode (macOS)**: Copies binary to `userData/core`, grants root via `osascript`, and spawns directly.
  - **IPC**: Communicates with renderer via `core:logs` and `core:stats`.
- **Main Process (`electron/main.ts`)**: Handles window creation, tray, and IPC bridging.
- **Store (`electron/store.ts`)**: Manages `config.yaml` and user settings using `electron-store`.

## Common Issues & Fixes
- **"Object has been destroyed"**: Occurs when IPC is sent to a closed window. Always use `sendToRenderer` wrapper in `KernelManager` or check `!win.isDestroyed()`.
- **Zombie Processes**: Ensure `kernel.stop()` is called on app exit (`before-quit`, `window-all-closed`).
- **Data Sync**: Ensure `kernel` has the correct `webContents` reference (update it in `createWindow`).

## Build
- `npm run dev`: Start dev server.
- `npm run build`: Build for production (uses `electron-builder`).
