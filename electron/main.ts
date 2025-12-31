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
let ipcHandlersRegistered = false

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function registerIpcHandlers() {
    if (ipcHandlersRegistered) return;
    ipcHandlersRegistered = true;

    // App
    ipcMain.handle('app:version', () => app.getVersion())

    // Kernel - Real Data
    ipcMain.handle('kernel:version', () => kernel?.getVersion())
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

        // TUN Mode: regenerate config and reload kernel
        if (data.tunMode !== undefined && store && kernel) {
            const configPath = await store.regenerateActiveProfile();
            if (configPath) {
                await kernel.updateConfig(configPath);
                console.log('[Main] Reloaded kernel with TUN mode:', data.tunMode);
            }
        }

        return newSettings;
    })
}

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

    // Initialize Core Components (only once)
    if (!store) {
        store = new StoreManager()
    }
    if (!kernel) {
        kernel = new KernelManager(win.webContents)

        // Start Kernel WITH active profile config
        const profiles = store.getProfiles()
        const activeProfile = profiles.find(p => p.active)
        if (activeProfile?.localPath) {
            console.log('[Main] Starting kernel with active profile:', activeProfile.localPath)
            kernel.start(activeProfile.localPath)
        } else {
            console.log('[Main] No active profile found, starting kernel without config')
            kernel.start()
        }
    } else {
        // Kernel exists, just update webContents reference
        kernel['webContents'] = win.webContents
    }

    // Register IPC handlers (only once)
    registerIpcHandlers();

    // Listen for renderer ready
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

    // Tray Implementation (only once)
    if (!tray) {
        const iconPath = path.join(process.env.VITE_PUBLIC, 'electron-vite.svg');
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

        tray = new Tray(icon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Show App', click: () => win?.show() },
            { type: 'separator' },
            {
                label: 'Quit', click: () => {
                    kernel?.stop();
                    app.quit();
                }
            }
        ]);
        tray.setToolTip('NewClash');
        tray.setContextMenu(contextMenu);
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        kernel?.stop()
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(createWindow)
