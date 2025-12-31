import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import axios from 'axios';

// No types for sudo-prompt, using require
const sudo = require('sudo-prompt');

export class KernelManager {
    private process: ChildProcess | null = null;
    private webContents: any;
    private port = 9090;
    private secret = '';
    private isElevated = false;
    private logFile = path.join(app.getPath('temp'), 'newclash-kernel.log');
    private logWatcher: NodeJS.Timeout | null = null;
    private logPosition = 0;
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

    // ...

    // (Inside startPolling, lines 155-162 original)


    // --- Core Lifecycle ---

    async start(configPath?: string, tunMode: boolean = false) {
        if (this.process || (this.isElevated && process.platform === 'win32')) {
            console.log('[Kernel] Already running');
            await this.updateConfig(configPath || '', tunMode);
            return;
        }

        console.log('[Kernel] Starting...');
        await this.cleanupPorts();

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

        // 4. Prepare Args
        const cwd = configPath ? path.dirname(configPath) : userDataDir;
        this.configFile = configPath || path.join(userDataDir, 'config.yaml');
        const args = ['-d', cwd, '-f', this.configFile];

        // 5. Permission Check & Spawn
        this.isElevated = tunMode;

        if (process.platform === 'darwin' || process.platform === 'linux') {
            // MacOS/Linux: Use SetUID logic
            if (tunMode) {
                const hasPerms = await this.checkSetUidPermissions(targetBinPath);
                if (!hasPerms) {
                    console.log('[Kernel] SetUID permissions missing for TUN. Requesting grant...');
                    this.sendToRenderer('core:logs', { type: 'info', payload: 'Requesting Admin Permissions for TUN Mode...', time: new Date().toLocaleTimeString() });
                    try {
                        await this.grantSetUidPermissions(targetBinPath);
                        console.log('[Kernel] Permissions granted.');
                    } catch (e: any) {
                        console.error('[Kernel] Failed to grant permissions:', e);
                        this.sendToRenderer('core:logs', { type: 'error', payload: 'Failed to acquire admin permissions: ' + e.message, time: new Date().toLocaleTimeString() });
                        return;
                    }
                }
            }
            // Spawn directly (Run as root if SetUID bit is set)
            this.startProcess(targetBinPath, args);
        } else {
            // Windows
            if (tunMode) {
                try {
                    await this.startElevatedWindows(targetBinPath, args);
                } catch (e: any) {
                    this.sendToRenderer('core:logs', { type: 'error', payload: 'Failed to start elevated kernel: ' + e.message, time: new Date().toLocaleTimeString() });
                }
            } else {
                this.startProcess(targetBinPath, args);
            }
        }

        // Wait a bit for startup
        await new Promise(r => setTimeout(r, 2000));
        this.startPolling();
    }

    // ... (Use sendToRenderer in other methods)


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
            return stats.uid === 0 && (stats.mode & 0o4000) !== 0;
        } catch (e) { return false; }
    }

    private async grantSetUidPermissions(binPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (process.platform === 'darwin') {
                // chown root:admin AND chmod 4755 (rwsr-xr-x)
                const script = `do shell script "chown root:admin \\\\"${binPath}\\\\" && chmod 4755 \\\\"${binPath}\\\\"" with administrator privileges`;
                const { exec } = require('child_process');
                exec(`osascript -e '${script}'`, (error: any) => {
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

        // Also pipe to frontend logs
        this.process.stdout?.on('data', (d) => {
            const msg = d.toString();
            // console.log('[Clash]', msg); // optional debug
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
            this.isElevated = false;
        });
        this.startTailingLog();
    }

    private async startElevatedWindows(binPath: string, args: string[]) {
        console.log('[Kernel] Starting Elevated (Windows)...');
        try { fs.writeFileSync(this.logFile, ''); } catch (e) { }
        this.startTailingLog();

        const cmd = `cmd /c start /b "" "${binPath}" ${args.map(a => ` "${a}"`).join('')} > "${this.logFile}" 2>&1`;
        return new Promise<void>((resolve, reject) => {
            const options = { name: 'NewClash' };
            sudo.exec(cmd, options, (error: any) => {
                if (error) reject(error);
                else {
                    this.isElevated = true;
                    resolve();
                }
            });
        });
    }

    private startTailingLog() {
        if (this.logWatcher) clearInterval(this.logWatcher);
        this.logPosition = 0;

        this.logWatcher = setInterval(() => {
            try {
                if (!fs.existsSync(this.logFile)) return;
                const stat = fs.statSync(this.logFile);
                if (stat.size > this.logPosition) {
                    const fd = fs.openSync(this.logFile, 'r');
                    const buffer = Buffer.alloc(stat.size - this.logPosition);
                    fs.readSync(fd, buffer, 0, buffer.length, this.logPosition);
                    fs.closeSync(fd);
                    this.logPosition = stat.size;

                    // We already stream stdout from own process, 
                    // this handles Windows elevated tailing (where we don't own output stream)
                    // Or double logging? SetUID process is owned, so we have stdout.
                    // Windows Elevated is NOT owned.
                    // So we should only emit here if process is elevated WINDOWS?
                    // Actually SetUID process output should go to pipe.

                    const newLog = buffer.toString();
                    if (this.process) return; // If we own process, stdout handler handles it.

                    newLog.split('\n').forEach(line => {
                        if (line.trim()) {
                            this.sendToRenderer('core:logs', { type: 'info', payload: line.trim(), time: new Date().toLocaleTimeString() });
                        }
                    });
                }
            } catch (e) { }
        }, 500);
    }

    async stop() {
        if (this.logWatcher) {
            clearInterval(this.logWatcher);
            this.logWatcher = null;
        }

        if (this.process) {
            console.log('[Kernel] Killing child process...');
            this.process.kill('SIGINT');
            // If SetUID, standard user kill might fail to kill ROOT process?
            // Actually, parent can usually signal child.
            // If not, we fall back to aggressive cleanup.
        } else if (this.isElevated) {
            // Windows or Detached
            if (process.platform === 'win32') {
                try {
                    const { execSync } = require('child_process');
                    execSync('taskkill /F /IM clash.exe', { stdio: 'ignore' });
                } catch (e) { }
            } else {
                // Should be covered by process.kill if attached.
                // If detached or lost ref:
                try {
                    const { execSync } = require('child_process');
                    execSync('pkill clash'); // Might need sudo if root
                } catch (e) { }
            }
        }

        await new Promise(r => setTimeout(r, 500));
        await this.cleanupPorts();

        this.process = null;
        this.isElevated = false;
        console.log('[Kernel] Stopped.');
    }

    private async cleanupPorts() {
        // Aggressive cleanup
        if (process.platform === 'darwin') {
            const killCmd = "lsof -P -i:9090 -i:7890 | grep LISTEN | awk '{print $2}' | xargs kill -9";
            try {
                const { execSync } = require('child_process');
                execSync(killCmd, { stdio: 'ignore' });
            } catch (e) {
                // Try elevated kill (osascript)
                const script = `do shell script "lsof -P -i:9090 -i:7890 | grep LISTEN | awk '{print $2}' | xargs kill -9" with administrator privileges`;
                try {
                    const { execSync } = require('child_process');
                    execSync(`osascript -e '${script}'`);
                } catch (e2) { }
            }
        } else if (process.platform === 'win32') {
            try {
                const { execSync } = require('child_process');
                execSync('taskkill /F /IM clash.exe', { stdio: 'ignore' });
            } catch (e) { }
        }
    }

    // --- API Methods ---

    private async startPolling() {
        setInterval(async () => {
            try {
                const res = await axios.get(`http://127.0.0.1:${this.port}/traffic`, { timeout: 1000 });
                if (res.data) this.sendToRenderer('core:stats', res.data);
            } catch (e) {
                // Silent fail to avoid log spam, but ensures loop continues
            }
        }, 1000);
    }

    async getVersion() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/version`);
            return res.data;
        } catch (e: any) {
            console.error('Failed to get version', e.message);
            return { version: 'unknown' };
        }
    }

    async getProxies() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/proxies`);
            return res.data;
        } catch (e: any) {
            console.error('Failed to get proxies', e.message);
            return { proxies: {} };
        }
    }

    async setProxy(group: string, name: string) {
        try {
            const encodedGroup = encodeURIComponent(group);
            await axios.put(`http://127.0.0.1:${this.port}/proxies/${encodedGroup}`, { name });
            return true;
        } catch (e) {
            console.error('Failed to select proxy', e);
            return false;
        }
    }

    async getConnections() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/connections`);
            return res.data;
        } catch (e) {
            return { connections: [] };
        }
    }

    async closeConnection(id: string) {
        try {
            await axios.delete(`http://127.0.0.1:${this.port}/connections/${id}`);
            return true;
        } catch (e) { return false; }
    }

    async closeAllConnections() {
        try {
            await axios.delete(`http://127.0.0.1:${this.port}/connections`);
            return true;
        } catch (e) { return false; }
    }

    async getProxyDelay(group: string, name: string) {
        try {
            const encodedName = encodeURIComponent(name);
            const res = await axios.get(`http://127.0.0.1:${this.port}/proxies/${encodedName}/delay`, {
                params: { timeout: 5000, url: 'http://www.gstatic.com/generate_204' }
            });
            return res.data;
        } catch (e) { return { delay: -1 }; }
    }

    async getMode() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/configs`);
            return res.data.mode;
        } catch (e) { return 'rule'; }
    }

    async setMode(mode: string) {
        try {
            await axios.patch(`http://127.0.0.1:${this.port}/configs`, { mode });
            return true;
        } catch (e) { return false; }
    }

    async updateConfig(configPath: string, tunMode: boolean = false) {
        if (!configPath) return false;

        // If not running, start
        if (!this.process && !this.isElevated) {
            this.start(configPath, tunMode);
            return true;
        }

        try {
            console.log(`[Kernel] Reloading config: ${configPath}`);
            await axios.put(`http://127.0.0.1:${this.port}/configs?force=true`, { path: configPath });

            // Check elevation mismatch
            if (this.isElevated !== tunMode) {
                console.log('Elevation mismatch, restarting...');
                await this.stop();
                setTimeout(() => this.start(configPath, tunMode), 1000);
            }
            return true;
        } catch (e) {
            console.log('[Kernel] Reload failed, restarting...', e);
            await this.stop();
            setTimeout(() => this.start(configPath, tunMode), 1000);
            return true;
        }
    }
}
