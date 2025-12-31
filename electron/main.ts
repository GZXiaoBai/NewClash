import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import { KernelManager } from './kernel'
import { StoreManager } from './store'
import { setSystemProxy } from './system'

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win: BrowserWindow | null
let tray: Tray | null = null
let kernel: KernelManager | null = null
let store: StoreManager | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 30
        },
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#09090b',
        show: false
    })

    // Initialize Core Components
    kernel = new KernelManager(win.webContents)
    store = new StoreManager()

    // Start Kernel (Will try to find binary)
    kernel.start()

    // --- IPC Handlers ---

    // App
    ipcMain.handle('app:version', () => app.getVersion())

    // Kernel - Real Data
    ipcMain.handle('proxy:list', () => kernel?.getProxies())
    ipcMain.handle('proxy:select', (_, { group, name }) => kernel?.setProxy(group, name))
    ipcMain.handle('proxy:url-test', (_, { group, name }) => kernel?.getProxyDelay(group, name))

    // Kernel - Connections
    ipcMain.handle('connection:list', () => kernel?.getConnections())
    ipcMain.handle('connection:close', (_, id) => kernel?.closeConnection(id))
    ipcMain.handle('connection:close-all', () => kernel?.closeAllConnections())

    // Kernel - Mode
    ipcMain.handle('mode:get', () => kernel?.getMode())
    ipcMain.handle('mode:set', (_, mode) => kernel?.setMode(mode))

    // Profiles
    ipcMain.handle('profile:list', () => store?.getProfiles())

    ipcMain.handle('profile:add', async (_, url: string) => {
        if (!store) return null;
        try {
            const { profiles, newProfile } = await store.addProfile(url);
            // If it's the first one (active), load it
            if (newProfile.active && kernel) {
                await kernel.updateConfig(newProfile.localPath);
            }
            return profiles;
        } catch (e) {
            console.error(e);
            return store.getProfiles(); // Return existing if fail
        }
    })

    ipcMain.handle('profile:update', async (_, { id, data }) => {
        if (!store) return null;
        const profiles = store.updateProfile(id, data);

        // If we just activated this profile, load it
        if (data.active && kernel) {
            const profile = profiles.find(p => p.id === id);
            if (profile?.localPath) {
                await kernel.updateConfig(profile.localPath);
            }
        }
        return profiles;
    })

    ipcMain.handle('profile:delete', (_, id) => store?.deleteProfile(id))

    ipcMain.handle('profile:import-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
            properties: ['openFile'],
            filters: [{ name: 'YAML Config', extensions: ['yaml', 'yml'] }]
        })
        if (!canceled && filePaths.length > 0 && store) {
            const { profiles, newProfile } = await store.addProfile(filePaths[0])
            if (newProfile.active && kernel) {
                await kernel.updateConfig(newProfile.localPath)
            }
            return profiles
        }
        return null
    })

    // Settings
    ipcMain.handle('settings:get', () => store?.getSettings())
    ipcMain.handle('settings:set', async (_, data) => {
        const newSettings = store?.updateSettings(data)

        // Handle Side Effects
        if (data.systemProxy !== undefined) {
            setSystemProxy(data.systemProxy, newSettings?.mixedPort || 7890);
        }

        if (data.tunMode !== undefined) {
            // If TUN changed, we might need to reload the current profile to inject/remove TUN config
            // For now, let's just trigger a reload if there is an active profile
            const profiles = store?.getProfiles();
            const active = profiles?.find(p => p.active);
            if (active) {
                // re-generate config logic is in StoreManager.addProfile mostly, but updateConfig sends the file.
                // We need to re-read the ORIGINAL file (or remote), re-process it with new settings, and save to localPath.
                // This is complex. 
                // Simple version: Just tell user to restart or re-select profile.
                // Better: We can tell kernel to restart, but kernel needs valid config.
                // Let's implement 'reconfigure' in Store?
                // For this step, we'll notify renderer to potentially show "Restart needed" or similar?
                // Or we can rely on the fact that 'updateSettings' just updates the store, and 'active' stays same.
                // We need to force re-write of the config file.
            }
        }

        return newSettings;
    })

    // Listen for renderer ready to sync initial state if needed
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        win.loadFile(path.join(process.env.DIST, 'index.html'))
    }

    win.once('ready-to-show', () => {
        win?.show()
    })

    // Tray Implementation
    const iconPath = path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'); // Use generic icon for now or dedicated tray icon
    // For macOS tray, it's best to use a template image (files ending in Template.png) for auto light/dark mode
    // But we'll stick to the existing icon for simplicity first
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => win?.show() },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                app.quit();
                kernel?.stop();
            }
        }
    ]);
    tray.setToolTip('NewClash');
    tray.setContextMenu(contextMenu);

    // On macOS, clicking the tray icon usually just opens the menu, but we can double click or change behavior?
    // Actually standard macOS behavior for Tray (Status Item) is just menu.
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        kernel?.stop()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)
