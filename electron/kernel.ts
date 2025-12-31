import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import axios, { AxiosInstance } from 'axios';

// No types for sudo-prompt, using require
const sudo = require('sudo-prompt');

export class KernelManager {
    private process: ChildProcess | null = null;
    private webContents: any;
    private ipcPath = '';
    private logFile = path.join(app.getPath('temp'), 'newclash-kernel.log');
    private axiosInstance: AxiosInstance | null = null;
    private configFile: string = '';

    constructor(webContents: any) {
        this.webContents = webContents;
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) { }
        }
    }

    setWebContents(webContents: any) {
        this.webContents = webContents;
    }

    private sendToRenderer(channel: string, data: any) {
        if (this.webContents && !this.webContents.isDestroyed()) {
            try {
                this.webContents.send(channel, data);
            } catch (e) {
                // Ignore send errors
            }
        }
    }

    // --- Core Lifecycle ---

    private getIpcPath(): string {
        if (process.platform === 'win32') {
            return `\\\\.\\pipe\\newclash-${process.pid}`;
        }
        const uid = process.getuid ? process.getuid() : 0;
        return `/tmp/newclash-${uid}-${process.pid}.sock`;
    }

    private async getAxios(force = false): Promise<AxiosInstance> {
        if (this.axiosInstance && !force) return this.axiosInstance;

        // Ensure socket exists (wait for it)
        if (!this.ipcPath) throw new Error('IPC Path not set');

        this.axiosInstance = axios.create({
            baseURL: 'http://localhost',
            socketPath: process.platform === 'win32' ? undefined : this.ipcPath, // Windows uses named pipes differently usually, but axios socketPath works for unix sockets
            // For Windows named pipes, axios might need specific handling or just http://localhost:port (if we fallback).
            // But let's assume Unix Socket focus for macOS issues now.
            timeout: 2000
        });

        // Add response interceptor for better error messages
        this.axiosInstance.interceptors.response.use(
            (response) => response.data,
            (error) => {
                // console.error('[Axios] Request failed:', error.message);
                return Promise.reject(error);
            }
        );

        return this.axiosInstance;
    }

    async start(configPath?: string, tunMode: boolean = false) {
        if (this.process) {
            console.log('[Kernel] Already running');
            await this.updateConfig(configPath || '', tunMode);
            return;
        }

        console.log('[Kernel] Starting (Socket Mode)...');
        await this.cleanupOldSockets();

        // 1. Resolve Binary Path
        let binaryName = 'clash';
        if (process.platform === 'win32') binaryName = 'clash.exe';

        let resourcesPath = process.resourcesPath;
        if (process.env.VITE_PUBLIC_ELECTRON_DEV === 'true' || !fs.existsSync(path.join(resourcesPath, 'bin', binaryName))) {
            resourcesPath = path.join(process.cwd());
        }

        const sourceBinPath = path.join(resourcesPath, 'bin', binaryName);

        // 2. Prepare Target (UserData/Core) for SetUID and Persistency
        const userDataDir = app.getPath('userData');
        const targetCoreDir = path.join(userDataDir, 'core');
        if (!fs.existsSync(targetCoreDir)) fs.mkdirSync(targetCoreDir, { recursive: true });

        const targetBinPath = path.join(targetCoreDir, binaryName);

        // 3. Copy Binary (if needed)
        this.ensureBinaryFiles(sourceBinPath, targetBinPath);

        // 4. Generate IPC Path
        this.ipcPath = this.getIpcPath();
        console.log('[Kernel] IPC Path:', this.ipcPath);

        // 5. Prepare Args
        const cwd = configPath ? path.dirname(configPath) : userDataDir;
        this.configFile = configPath || path.join(userDataDir, 'config.yaml');

        // Use -ext-ctl-unix (macOS/Linux) or -ext-ctl-pipe (Windows)
        const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix';

        const args = ['-d', cwd, '-f', this.configFile, ctlParam, this.ipcPath];

        // 6. Permission Check & Spawn
        if (process.platform === 'darwin' || process.platform === 'linux') {
            // Check SetUID permissions
            const hasPerms = await this.checkSetUidPermissions(targetBinPath);
            if (!hasPerms) {
                console.log('[Kernel] SetUID permissions missing. Requesting grant...');
                this.sendToRenderer('core:logs', { type: 'info', payload: 'Requesting Admin Permissions (One-Time Setup)...', time: new Date().toLocaleTimeString() });
                try {
                    await this.grantSetUidPermissions(targetBinPath);
                    console.log('[Kernel] Permissions granted.');
                    this.sendToRenderer('core:logs', { type: 'info', payload: 'Permissions Granted.', time: new Date().toLocaleTimeString() });
                } catch (e: any) {
                    console.error('[Kernel] Failed to grant permissions:', e);
                    this.sendToRenderer('core:logs', { type: 'error', payload: 'Start as User Mode (Admin denied): ' + e.message, time: new Date().toLocaleTimeString() });
                    // Proceed to spawn as user
                }
            }

            // Spawn directly - The SetUID bit allows it to run as root automatically
            // But 'spawn' uses user privileges by default unless file system handling does it.
            // On Unix, executing a SetUID binary gives it the owner's privileges (root).
            this.startProcess(targetBinPath, args);
        } else {
            // Windows
            // For now, keep simple spawn. Windows Named Pipes don't conflict like ports.
            // If TUN is needed, Windows needs Admin.
            // We can implement 'startElevatedWindows' logic similar to before if specific to Windows, 
            // but mapped to using the pipe arg instead of port.
            if (tunMode) {
                // Warning: Using pipe with startElevatedWindows needs logic adjustment, 
                // but for now focus on macOS.
                this.startProcess(targetBinPath, args);
            } else {
                this.startProcess(targetBinPath, args);
            }
        }

        // Wait for socket to be ready
        await this.waitForCoreReady();
        if (tunMode) {
            // Only set if not already auto-enabled by config. 
            // In SetUID mode, it should just work if config says tun: enable
            // We can send a patch request to ensure it.
            // But let's trust the config file reload for now.
        }

        this.startPolling();
    }

    private ensureBinaryFiles(source: string, target: string) {
        if (!fs.existsSync(source)) {
            console.error('[Kernel] Source binary not found:', source);
            return;
        }

        let shouldCopy = !fs.existsSync(target);
        if (!shouldCopy) {
            try {
                const statSrc = fs.statSync(source);
                const statTgt = fs.statSync(target);
                // Copy if size differs OR source is newer
                if (statSrc.size !== statTgt.size || statSrc.mtimeMs > statTgt.mtimeMs) {
                    shouldCopy = true;
                }
            } catch (e) { shouldCopy = true; }
        }

        if (shouldCopy) {
            try {
                if (fs.existsSync(target)) fs.unlinkSync(target);
                fs.copyFileSync(source, target);
                // 0o755 is base, but we will upgrade to 4755 later via grant
                fs.chmodSync(target, 0o755);
                console.log('[Kernel] Updated binary:', target);
            } catch (e) {
                console.error('[Kernel] Copy failed:', e);
            }
        }
    }

    private async checkSetUidPermissions(binPath: string): Promise<boolean> {
        try {
            const stats = fs.statSync(binPath);
            // Check if owner is root (0) AND SetUID bit (0o4000) is set
            return stats.uid === 0 && (stats.mode & 0o4000) !== 0; // 0o4000 is S_ISUID
        } catch (e) { return false; }
    }

    private async grantSetUidPermissions(binPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (process.platform === 'darwin') {
                // Use execFile to avoid shell escaping issues
                const script = `do shell script "chown root:admin \\"${binPath}\\" && chmod 4755 \\"${binPath}\\"" with administrator privileges`;
                const { execFile } = require('child_process');
                execFile('osascript', ['-e', script], (error: any) => {
                    if (error) reject(error);
                    else resolve();
                });
            } else {
                reject(new Error('Manual permission grant required on this platform'));
            }
        });
    }

    private startProcess(binPath: string, args: string[]) {
        console.log(`[Kernel] Spawning: ${binPath} ${args.join(' ')}`);
        try { fs.writeFileSync(this.logFile, ''); } catch (e) { }
        const logStream = fs.createWriteStream(this.logFile, { flags: 'a' });

        this.process = spawn(binPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GODEBUG: 'netdns=go' }
        });

        this.process.stdout?.pipe(logStream);
        this.process.stderr?.pipe(logStream);

        // Pipe to frontend
        this.process.stdout?.on('data', (d) => {
            const msg = d.toString();
            this.sendToRenderer('core:logs', { type: 'info', payload: msg.trim(), time: new Date().toLocaleTimeString() });
        });
        this.process.stderr?.on('data', (d) => {
            const msg = d.toString();
            this.sendToRenderer('core:logs', { type: 'error', payload: msg.trim(), time: new Date().toLocaleTimeString() });
        });

        this.process.on('error', (err) => console.error('[Kernel] Process error:', err));
        this.process.on('exit', (code, sig) => {
            console.log(`[Kernel] Exited: ${code} ${sig}`);
            this.process = null;
        });
    }

    private async waitForCoreReady() {
        for (let i = 0; i < 20; i++) {
            try {
                const api = await this.getAxios(true);
                await api.get('/version'); // Test connection
                console.log('[Kernel] Connection established via Socket/Pipe');
                return;
            } catch (e) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        console.error('[Kernel] Failed to connect to core after waiting.');
    }

    async stop() {
        if (this.process) {
            console.log('[Kernel] Killing child process...');
            this.process.kill('SIGINT');
        } else {
            // Fallback cleanup if reference lost
            const cleanupCmd = process.platform === 'win32'
                ? 'taskkill /F /IM clash.exe'
                : 'pkill clash';
            try { require('child_process').execSync(cleanupCmd, { stdio: 'ignore' }); } catch (e) { }
        }

        await this.cleanupOldSockets();
        this.process = null;
        this.axiosInstance = null;
        console.log('[Kernel] Stopped.');
    }

    private async cleanupOldSockets() {
        if (process.platform !== 'win32' && this.ipcPath && fs.existsSync(this.ipcPath)) {
            try { fs.unlinkSync(this.ipcPath); } catch (e) { }
        }
        // Also clean general pattern if needed
        try {
            const tmpDir = '/tmp';
            if (fs.existsSync(tmpDir)) {
                const files = fs.readdirSync(tmpDir);
                files.filter(f => f.startsWith('newclash-') && f.endsWith('.sock')).forEach(f => {
                    try { fs.unlinkSync(path.join(tmpDir, f)); } catch (e) { }
                });
            }
        } catch (e) { }
    }

    // --- API Methods ---

    private async startPolling() {
        setInterval(async () => {
            if (!this.process) return;
            try {
                const api = await this.getAxios();
                const res = await api.get('/traffic', { timeout: 1000 }) as any;
                if (res) this.sendToRenderer('core:stats', res);
            } catch (e) { }
        }, 1000);
    }

    async getVersion() {
        try {
            const api = await this.getAxios();
            return await api.get('/version');
        } catch (e: any) {
            return { version: 'unknown' };
        }
    }

    async getProxies() {
        try {
            const api = await this.getAxios();
            return await api.get('/proxies');
        } catch (e: any) {
            return { proxies: {} };
        }
    }

    async setProxy(group: string, name: string) {
        try {
            const api = await this.getAxios();
            await api.put(`/proxies/${encodeURIComponent(group)}`, { name });
            return true;
        } catch (e) { return false; }
    }

    async getConnections() {
        try {
            const api = await this.getAxios();
            return await api.get('/connections');
        } catch (e) { return { connections: [] }; }
    }

    async closeConnection(id: string) {
        try {
            const api = await this.getAxios();
            await api.delete(`/connections/${id}`);
            return true;
        } catch (e) { return false; }
    }

    async closeAllConnections() {
        try {
            const api = await this.getAxios();
            await api.delete('/connections');
            return true;
        } catch (e) { return false; }
    }

    async getProxyDelay(group: string, name: string) {
        try {
            const api = await this.getAxios();
            const res: any = await api.get(`/proxies/${encodeURIComponent(name)}/delay`, {
                params: { timeout: 5000, url: 'http://www.gstatic.com/generate_204' }
            });
            return res;
        } catch (e) { return { delay: -1 }; }
    }

    async getMode() {
        try {
            const api = await this.getAxios();
            const res: any = await api.get('/configs');
            return res.mode;
        } catch (e) { return 'rule'; }
    }

    async setMode(mode: string) {
        try {
            const api = await this.getAxios();
            await api.patch('/configs', { mode });
            return true;
        } catch (e) { return false; }
    }

    async updateConfig(configPath: string, tunMode: boolean = false) {
        if (!configPath) return false;

        if (!this.process) {
            this.start(configPath, tunMode);
            return true;
        }

        try {
            console.log(`[Kernel] Reloading config: ${configPath}`);
            const api = await this.getAxios();
            await api.put('/configs?force=true', { path: configPath });
            return true;
        } catch (e) {
            console.log('[Kernel] Reload via API failed, restarting process...', e);
            await this.stop();
            setTimeout(() => this.start(configPath, tunMode), 1000);
            return true;
        }
    }
}
