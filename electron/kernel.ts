import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import axios from 'axios';

export class KernelManager {
    private process: ChildProcess | null = null;
    private webContents: any;
    private port = 9090;
    private secret = '';

    constructor(webContents: any) {
        this.webContents = webContents;
    }

    // Find binary path
    private getBinaryPath(): string {
        const platform = process.platform;
        let binaryName = 'clash';
        if (platform === 'win32') binaryName = 'clash.exe';

        const paths = [
            path.join(process.cwd(), 'bin', binaryName),
            path.join(process.resourcesPath, 'bin', binaryName),
            path.join(app.getPath('userData'), 'bin', binaryName),
            '/usr/local/bin/clash' // Fallback for macOS
        ];

        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }

        return ''; // Not found
    }

    private async cleanupPorts() {
        if (process.platform === 'darwin') {
            try {
                // Kill process listening on 9090 (API) and 7890 (Mixed)
                const { exec } = require('child_process');
                const killCmd = "lsof -P -i:9090 -i:7890 | grep LISTEN | awk '{print $2}' | xargs kill -9";
                exec(killCmd, (err: any) => {
                    // ignore error
                });
                await new Promise(r => setTimeout(r, 500));
            } catch (e) { }
        } else if (process.platform === 'win32') {
            try {
                const { exec } = require('child_process');
                // Find and Kill process on 9090
                const findAndKill = (port: number) => {
                    return new Promise<void>((resolve) => {
                        exec(`netstat -ano | findstr :${port}`, (err: any, stdout: string) => {
                            if (err || !stdout) { resolve(); return; }

                            // Parse output lines to find PIDs
                            // TCP    0.0.0.0:9090           0.0.0.0:0              LISTENING       1234
                            const lines = stdout.split('\n');
                            lines.forEach(line => {
                                const parts = line.trim().split(/\s+/);
                                const pid = parts[parts.length - 1];
                                if (pid && /^\d+$/.test(pid)) {
                                    try {
                                        process.kill(parseInt(pid), 9); // or taskkill
                                        // exec(`taskkill /F /PID ${pid}`, () => {});
                                    } catch (e) { }
                                }
                            });
                            resolve();
                        });
                    });
                }

                await findAndKill(9090);
                await findAndKill(7890);
                await new Promise(r => setTimeout(r, 500));
            } catch (e) { }
        }
    }

    async start(configPath?: string) {
        await this.cleanupPorts();

        const binPath = this.getBinaryPath();
        if (!binPath) {
            console.error('Clash binary not found');
            this.webContents.send('core:logs', { type: 'error', payload: 'Clash binary not found. Please place "clash" in ./bin folder.', time: new Date().toLocaleTimeString() });
            return;
        }

        // Grant execute permissions (Critical for macOS/Linux)
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(binPath, 0o755);
            } catch (e) {
                console.error('[Kernel] Failed to set permissions:', e);
            }
        }

        // Arguments
        // If configPath is provided, use its directory as CWD. 
        // If NOT provided, use userData directly (don't name dirname on it, it is a dir).
        const cwd = configPath ? path.dirname(configPath) : app.getPath('userData');
        const args = ['-d', cwd];
        if (configPath) args.push('-f', configPath);

        // Explicitly set controller port if we generated the config
        // For now we assume the config file handles it or we use default 9090

        console.log(`Spawning kernel: ${binPath} ${args.join(' ')}`);

        this.process = spawn(binPath, args);

        this.process.stdout?.on('data', (data) => {
            const message = data.toString();
            console.log(`[Clash] ${message}`);
            // Parse log level?
            this.webContents.send('core:logs', { type: 'info', payload: message.trim(), time: new Date().toLocaleTimeString() });
        });

        this.process.stderr?.on('data', (data) => {
            const message = data.toString();
            console.error(`[Clash Error] ${message}`);
            this.webContents.send('core:logs', { type: 'error', payload: message.trim(), time: new Date().toLocaleTimeString() });
        });

        // Start polling stats
        this.startPolling();
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    // --- API Interaction ---

    private async startPolling() {
        // Poll Traffic
        setInterval(async () => {
            try {
                const res = await axios.get(`http://127.0.0.1:${this.port}/traffic`, { timeout: 1000 });
                if (res.data) {
                    this.webContents.send('core:stats', res.data);
                }
            } catch (e) {
                // ignore connection errors if core is starting
            }
        }, 1000);

        // Poll Logs (Websocket is better but polling for simplicity first or use WS)
        // Actually, standard Clash provides a WS for logs at /logs
        // Implementing WS connection here is overkill for this step, let's stick to process stdout for logs
    }

    async getProxies() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/proxies`);
            console.log('[Kernel] Fetched proxies:', Object.keys(res.data?.proxies || {}).length, 'items');
            // console.log('[Kernel] Proxy keys:', Object.keys(res.data?.proxies || {})); 
            return res.data;
        } catch (e) {
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
            // console.error('Failed to get connections', e);
            return { connections: [] };
        }
    }

    async closeConnection(id: string) {
        try {
            await axios.delete(`http://127.0.0.1:${this.port}/connections/${id}`);
            return true;
        } catch (e) {
            console.error(`Failed to close connection ${id}`, e);
            return false;
        }
    }

    async closeAllConnections() {
        try {
            await axios.delete(`http://127.0.0.1:${this.port}/connections`);
            return true;
        } catch (e) {
            console.error('Failed to close all connections', e);
            return false;
        }
    }

    async getProxyDelay(group: string, name: string) {
        try {
            // Clash API: GET /proxies/:name/delay?timeout=2000&url=http://www.gstatic.com/generate_204
            const encodedName = encodeURIComponent(name);
            const res = await axios.get(`http://127.0.0.1:${this.port}/proxies/${encodedName}/delay`, {
                params: {
                    timeout: 5000,
                    url: 'http://www.gstatic.com/generate_204'
                }
            });
            return res.data; // { delay: number }
        } catch (e) {
            // console.error(`Failed to test delay for ${name}`, e.message);
            return { delay: -1 };
        }
    }

    async getMode() {
        try {
            const res = await axios.get(`http://127.0.0.1:${this.port}/configs`);
            return res.data.mode; // 'rule', 'global', 'direct'
        } catch (e) {
            console.error('Failed to get mode', e);
            return 'rule';
        }
    }

    async setMode(mode: string) {
        try {
            await axios.patch(`http://127.0.0.1:${this.port}/configs`, { mode });
            return true;
        } catch (e) {
            console.error(`Failed to set mode to ${mode}`, e);
            return false;
        }
    }

    async updateConfig(configPath: string) {
        if (!configPath) return false;

        // 1. If process not running, start it (restart logic handled differently but ok for now)
        if (!this.process) {
            this.start(configPath);
            return true;
        }

        // 2. If running, use API to reload
        try {
            console.log(`[Kernel] Reloading config: ${configPath}`);
            // Mihomo/Clash Premium usually supports payload { path: '...' }
            await axios.put(`http://127.0.0.1:${this.port}/configs?force=true`, {
                path: configPath
            });
            return true;
        } catch (e) {
            console.error('Failed to reload config via API, restarting kernel...', e);
            // Fallback: Restart process
            this.stop();
            // Wait a bit
            setTimeout(() => this.start(configPath), 500);
            return true;
        }
    }
}
