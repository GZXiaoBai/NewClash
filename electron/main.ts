import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import { KernelManager } from './kernel'
import { StoreManager } from './store'
import { setSystemProxy } from './system'
import { checkAutoRun, enableAutoRun, disableAutoRun } from './autoRun'
import { getCurrentCoreVersion, getAvailableVersions, installCoreVersion, checkForUpdate } from './coreUpdater'

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win: BrowserWindow | null
let tray: Tray | null = null
let kernel: KernelManager | null = null
let store: StoreManager | null = null
let ipcHandlersRegistered = false
let isQuitting = false

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Single instance lock - prevent multiple instances and handle port conflicts
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    // Another instance is running, quit immediately
    isQuitting = true
    app.quit()
} else {
    // This is the first instance, register second-instance handler
    app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window
        if (win) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
        }
    })
}

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
                const settings = store.getSettings();
                await kernel.updateConfig(newProfile.localPath, settings.tunMode);
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
                const settings = store.getSettings();
                await kernel.updateConfig(profile.localPath, settings.tunMode);
            }
        }
        return profiles;
    })

    ipcMain.handle('profile:delete', (_, id) => store?.deleteProfile(id))

    // Refresh a single profile (re-download)
    ipcMain.handle('profile:refresh', async (_, id: string) => {
        if (!store) return { success: false, error: 'Store not initialized' };
        const result = await store.refreshProfile(id);
        if (result.success) {
            // If it's the active profile, reload kernel
            const profiles = store.getProfiles();
            const profile = profiles.find(p => p.id === id);
            if (profile?.active && kernel) {
                const settings = store.getSettings();
                await kernel.updateConfig(profile.localPath, settings.tunMode);
            }
        }
        return result;
    })

    ipcMain.handle('profile:import-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
            properties: ['openFile'],
            filters: [{ name: 'YAML Config', extensions: ['yaml', 'yml'] }]
        })
        if (!canceled && filePaths.length > 0 && store) {
            const { profiles, newProfile } = await store.addProfile(filePaths[0])
            if (newProfile.active && kernel) {
                const settings = store.getSettings();
                await kernel.updateConfig(newProfile.localPath, settings.tunMode)
            }
            return profiles
        }
        return null
    })

    // Settings
    ipcMain.handle('settings:get', () => store?.getSettings())

    // AutoStart (Phase 2)
    ipcMain.handle('autostart:check', async () => {
        return await checkAutoRun();
    })

    ipcMain.handle('autostart:set', async (_, enable: boolean) => {
        try {
            if (enable) {
                await enableAutoRun();
            } else {
                await disableAutoRun();
            }
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    })

    // Core Version Management (Phase 3)
    ipcMain.handle('core:version', async () => {
        return await getCurrentCoreVersion();
    })

    ipcMain.handle('core:versions', async () => {
        try {
            return await getAvailableVersions();
        } catch (e: any) {
            return [];
        }
    })

    ipcMain.handle('core:install', async (_, version: string) => {
        // Stop kernel before installing
        if (kernel) {
            await kernel.stop();
        }

        const result = await installCoreVersion(version);

        // Restart kernel if installation successful
        if (result.success && store && kernel) {
            const activeProfile = store.getProfiles().find(p => p.active);
            if (activeProfile) {
                const settings = store.getSettings();
                await kernel.start(activeProfile.localPath, settings.tunMode);
            }
        }

        return result;
    })

    ipcMain.handle('core:checkUpdate', async () => {
        return await checkForUpdate();
    })

    ipcMain.handle('settings:set', async (_, data) => {
        const newSettings = store?.updateSettings(data)

        // Handle Side Effects
        if (data.systemProxy !== undefined) {
            setSystemProxy(data.systemProxy, newSettings?.mixedPort || 7892);
        }

        // TUN Mode: regenerate config and reload kernel
        if (data.tunMode !== undefined && store && kernel) {
            const configPath = await store.regenerateActiveProfile();
            if (configPath) {
                // Determine the correct TUN mode state (use the new setting)
                // If data.tunMode is explicitly set, use it. Otherwise use store value.
                const tunMode = data.tunMode;
                await kernel.updateConfig(configPath, tunMode);
                console.log('[Main] Reloaded kernel with TUN mode:', tunMode);
            }
        }

        // Window Theme (TitleBar Overlay for Windows)
        if (data.theme !== undefined && win) {
            // Light theme -> Black symbols
            // Dark theme -> White symbols
            const symbolColor = data.theme === 'light' ? '#000000' : '#ffffff';
            win.setTitleBarOverlay({
                color: '#00000000',
                symbolColor: symbolColor,
                height: 30
            });
        }

        return newSettings;
    })
}

function createWindow() {
    // Initialize Core Components (only once)
    if (!store) {
        store = new StoreManager()
    }

    const settings = store.getSettings();
    const isLight = settings?.theme === 'light';

    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: isLight ? '#000000' : '#ffffff',
            height: 30
        },
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#09090b',
        show: false
    })

    if (!kernel) {
        kernel = new KernelManager(win.webContents)

        // Start Kernel WITH active profile config
        const profiles = store.getProfiles()
        const activeProfile = profiles.find(p => p.active)
        const settings = store.getSettings();
        if (activeProfile?.localPath) {
            console.log('[Main] Starting kernel with active profile:', activeProfile.localPath)
            kernel.start(activeProfile.localPath, settings.tunMode)
        } else {
            console.log('[Main] No active profile found, starting kernel without config')
            kernel.start(undefined, settings.tunMode)
        }
    } else {
        // Kernel exists, just update webContents reference
        kernel.setWebContents(win.webContents)
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

    // Handle window close - show dialog or minimize to tray based on settings
    win.on('close', (event) => {
        if (!win || !store || isQuitting) return;

        const settings = store.getSettings();

        // If user has already made a choice, use it
        if (settings.closeToTrayAsked) {
            if (settings.closeToTray) {
                event.preventDefault();
                win.hide();
            }
            // else: let it close normally
            return;
        }

        // First time closing - show dialog (Windows only, macOS uses different behavior)
        if (process.platform !== 'darwin') {
            event.preventDefault();

            dialog.showMessageBox(win, {
                type: 'question',
                buttons: ['最小化到托盘', '退出程序'],
                defaultId: 0,
                cancelId: 1,
                title: '关闭窗口',
                message: '您想要如何处理？',
                detail: '选择"最小化到托盘"将保持程序在后台运行。',
                checkboxLabel: '记住我的选择',
                checkboxChecked: false
            }).then((result) => {
                const minimizeToTray = result.response === 0;
                const rememberChoice = result.checkboxChecked;

                if (rememberChoice) {
                    store?.updateSettings({
                        closeToTray: minimizeToTray,
                        closeToTrayAsked: true
                    });
                }

                if (minimizeToTray) {
                    win?.hide();
                } else {
                    kernel?.stop();
                    // Force exit to prevent zombie processes, especially after using child_process/sudo
                    app.exit(0);
                }
            });
        }
    });

    // Clean up window reference explicitly
    win.on('closed', () => {
        win = null;
        kernel?.setWebContents(null);
    });

    // Tray Implementation (only once)
    if (!tray) {
        // Use tray-icon.png (preferred for cross-platform compatibility if .ico is missing)
        const iconPath = path.join(process.env.VITE_PUBLIC, 'tray-icon.png');
        const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
        tray = new Tray(icon);
        tray.setToolTip('NewClash');

        // Update tray menu dynamically
        updateTrayMenu();

        // Refresh tray menu periodically to reflect state changes
        setInterval(updateTrayMenu, 3000);
    }
}

// Dynamic Tray Menu Builder
async function updateTrayMenu() {
    if (!tray) return;

    const settings = store?.getSettings() || { systemProxy: false, tunMode: false, mixedPort: 7890 };
    const currentMode = await kernel?.getMode() || 'rule';

    // Get proxy groups for submenu
    let proxySubmenu: Electron.MenuItemConstructorOptions[] = [];
    try {
        const proxyData = await kernel?.getProxies();
        if (proxyData?.proxies) {
            // Find selector groups (groups that can switch proxies)
            const groups = Object.entries(proxyData.proxies)
                .filter(([_, v]: [string, any]) => v.type === 'Selector' || v.type === 'URLTest')
                .slice(0, 5); // Limit to 5 groups for menu size

            for (const [groupName, groupData] of groups as [string, any][]) {
                const currentProxy = groupData.now || '';
                const proxies = groupData.all || [];

                if (proxies.length > 0) {
                    proxySubmenu.push({
                        label: groupName,
                        submenu: proxies.slice(0, 15).map((proxyName: string) => ({
                            label: proxyName,
                            type: 'radio' as const,
                            checked: proxyName === currentProxy,
                            click: async () => {
                                await kernel?.setProxy(groupName, proxyName);
                                updateTrayMenu();
                            }
                        }))
                    });
                }
            }
        }
    } catch (e) {
        // Kernel may not be ready yet
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: 'NewClash', enabled: false },
        { type: 'separator' },

        // Mode Selection
        {
            label: '🌐 模式',
            submenu: [
                {
                    label: '规则 (Rule)',
                    type: 'radio',
                    checked: currentMode === 'rule',
                    click: async () => {
                        await kernel?.setMode('rule');
                        updateTrayMenu();
                    }
                },
                {
                    label: '全局 (Global)',
                    type: 'radio',
                    checked: currentMode === 'global',
                    click: async () => {
                        await kernel?.setMode('global');
                        updateTrayMenu();
                    }
                },
                {
                    label: '直连 (Direct)',
                    type: 'radio',
                    checked: currentMode === 'direct',
                    click: async () => {
                        await kernel?.setMode('direct');
                        updateTrayMenu();
                    }
                }
            ]
        },

        { type: 'separator' },

        // System Proxy Toggle
        {
            label: settings.systemProxy ? '✅ 系统代理' : '⬜ 系统代理',
            click: async () => {
                const newValue = !settings.systemProxy;
                store?.updateSettings({ systemProxy: newValue });
                await setSystemProxy(newValue, settings.mixedPort || 7890);
                updateTrayMenu();
            }
        },

        // TUN Mode Toggle
        {
            label: settings.tunMode ? '✅ TUN 模式' : '⬜ TUN 模式',
            click: async () => {
                const newValue = !settings.tunMode;
                store?.updateSettings({ tunMode: newValue });
                // TUN requires config regeneration
                const configPath = await store?.regenerateActiveProfile();
                if (configPath) {
                    await kernel?.updateConfig(configPath, newValue);
                }
                updateTrayMenu();
            }
        },

        { type: 'separator' },

        // Proxy Selection (if available)
        ...(proxySubmenu.length > 0 ? [
            { label: '🔗 节点选择', submenu: proxySubmenu }
        ] : []),

        ...(proxySubmenu.length > 0 ? [{ type: 'separator' as const }] : []),

        // Standard items
        { label: '📱 显示主窗口', click: () => win?.show() },
        { type: 'separator' },
        {
            label: '❌ 退出', click: () => {
                kernel?.stop();
                app.exit(0);
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        kernel?.stop()
        app.quit()
    }
})

// Ensure kernel is stopped before app quits (critical for Windows cleanup)
app.on('before-quit', () => {
    isQuitting = true
    console.log('[Main] App quitting, stopping kernel...')
    kernel?.stop()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    } else {
        win?.show()
    }
})

app.whenReady().then(() => {
    createWindow()

    // Register Theme Update Handler
    ipcMain.handle('window:update-theme', (_, theme) => {
        if (win) {
            // Update TitleBarOverlay Symbol Color (Mainly for Windows)
            // Light theme -> Black symbols
            // Dark theme -> White symbols
            win.setTitleBarOverlay({
                color: '#00000000',
                symbolColor: theme === 'light' ? '#000000' : '#ffffff',
                height: 30
            })
        }
    })
})
