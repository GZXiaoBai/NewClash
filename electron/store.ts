import Store from 'electron-store';
import yaml from 'js-yaml';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface Profile {
    id: string;
    name: string;
    url: string; // Remote URL or Local Path
    localPath: string; // Actual file path on disk
    active: boolean;
    updated: number; // timestamp
    userInfo?: {
        upload: number;
        download: number;
        total: number;
        expire: number;
    };
    // Auto Update Settings (Phase 2)
    autoUpdate?: boolean;
    interval?: number; // minutes
}

interface Settings {
    theme: 'dark' | 'light' | 'system';
    mixedPort: number;
    allowLan: boolean;
    systemProxy: boolean;
    tunMode: boolean;
    closeToTray: boolean;      // true = minimize to tray on close, false = quit
    closeToTrayAsked: boolean; // true = user has made a choice, don't ask again
}

interface Schema {
    profiles: Profile[];
    settings: Settings;
}

export class StoreManager {
    private store: Store<Schema>;
    private profilesDir: string;

    constructor() {
        this.profilesDir = path.join(app.getPath('userData'), 'profiles');
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
        }

        this.store = new Store<Schema>({
            defaults: {
                profiles: [],
                settings: {
                    theme: 'dark',
                    mixedPort: 7892,
                    allowLan: false,
                    systemProxy: false,
                    tunMode: false,
                    closeToTray: true,      // Default: minimize to tray
                    closeToTrayAsked: false // Default: ask user on first close
                }
            }
        });
    }

    // --- Profiles ---
    getProfiles() {
        return this.store.get('profiles');
    }

    async addProfile(url: string) {
        const profiles = this.getProfiles();
        const id = Math.random().toString(36).substring(7);
        const name = url.startsWith('http') ? `Subscription ${profiles.length + 1}` : 'Local Config';
        let localPath = '';
        let userInfo: { upload: number; download: number; total: number; expire: number; } | undefined = undefined;

        if (url.startsWith('http')) {
            try {
                // Download content using Axios
                const axios = (await import('axios')).default;
                const response = await axios.get(url, {
                    headers: { 'User-Agent': 'ClashMeta/1.18.0' },
                    timeout: 15000,
                    responseType: 'text' // Ensure we get text/string
                });

                // Parse Subscription Info (Axios headers are lower-cased)
                const subInfoStr = response.headers['subscription-userinfo'];
                if (subInfoStr) {
                    try {
                        const parts = Array.isArray(subInfoStr) ? subInfoStr[0].split(';') : subInfoStr.split(';');
                        const info: any = {};
                        parts.forEach((p: string) => {
                            const [k, v] = p.trim().split('=');
                            if (k && v) info[k] = parseInt(v, 10);
                        });
                        userInfo = info;
                    } catch (e) {
                        console.error('[Store] Failed to parse sub info:', e);
                    }
                }

                let content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

                // Try to parse YAML
                let config: any = null;
                try {
                    config = yaml.load(content);
                } catch (e) {
                    // Try Base64 Decode
                    try {
                        const decoded = Buffer.from(content, 'base64').toString('utf-8');
                        config = yaml.load(decoded);
                        content = decoded; // Update content to decoded version
                    } catch (decodeErr) {
                        console.error('Invalid YAML and not Base64', e);
                        throw new Error('Invalid Configuration Content');
                    }
                }

                // Inject Defaults if missing
                if (config && typeof config === 'object') {
                    let dirty = false;
                    const settings = this.getSettings();

                    // === CRITICAL PORT/NETWORK SETTINGS (Always enforce) ===
                    // These settings MUST be controlled by the app to ensure proxy works correctly

                    // Force mixed-port - this is the main proxy port
                    if (config['mixed-port'] !== settings.mixedPort) {
                        config['mixed-port'] = settings.mixedPort;
                        dirty = true;
                    }

                    // Force allow-lan setting from app config
                    if (config['allow-lan'] !== settings.allowLan) {
                        config['allow-lan'] = settings.allowLan;
                        dirty = true;
                    }

                    // Bind address - needed for proper network binding
                    if (config['bind-address'] === undefined) {
                        config['bind-address'] = '*';
                        dirty = true;
                    }

                    // IPv6 support
                    if (config['ipv6'] === undefined) {
                        config['ipv6'] = false;
                        dirty = true;
                    }

                    // TCP Concurrent for better performance
                    if (config['tcp-concurrent'] === undefined) {
                        config['tcp-concurrent'] = true;
                        dirty = true;
                    }

                    // Unified Delay for accurate speed tests
                    if (config['unified-delay'] === undefined) {
                        config['unified-delay'] = true;
                        dirty = true;
                    }

                    // Log level
                    if (!config['log-level'] || !['info', 'debug', 'warning', 'error', 'silent'].includes(config['log-level'])) {
                        config['log-level'] = 'info';
                        dirty = true;
                    }

                    // Mode default
                    if (!config['mode']) {
                        config['mode'] = 'rule';
                        dirty = true;
                    }

                    // TUN Mode Injection
                    if (settings.tunMode) {
                        if (!config['tun']) {
                            config['tun'] = {
                                enable: true,
                                stack: 'system',
                                'auto-route': true,
                                'auto-detect-interface': true,
                                'dns-hijack': ['any:53']
                            };
                            dirty = true;
                        }

                        // Enforce DNS for TUN
                        // TUN mode requires DNS to be enabled and ideally fake-ip for best performance/compat
                        if (!config['dns']) config['dns'] = {};

                        // Force enable and basic settings
                        config['dns']['enable'] = true;
                        config['dns']['ipv6'] = false; // Disable IPv6 to prevent leaks/issues
                        config['dns']['enhanced-mode'] = 'fake-ip'; // Force fake-ip for TUN stability
                        config['dns']['listen'] = '0.0.0.0:1053';
                        dirty = true;

                        // Ensure at least one nameserver
                        // Ensure at least one nameserver
                        if (!config['dns']['nameserver'] || config['dns']['nameserver'].length === 0) {
                            // CN-Friendly DNS Order:
                            // 1. Domestic (AliDNS/114) for bootstrapping and non-proxy domains
                            // 2. Foreign (Google/Cloudflare) as fallback
                            config['dns']['nameserver'] = [
                                '223.5.5.5',        // AliDNS
                                '114.114.114.114',  // 114DNS
                                '8.8.8.8',
                                '1.1.1.1'
                            ];
                            // Also set fallback if not present (optional, but good for Clash)
                            config['dns']['fallback'] = [
                                '8.8.8.8',
                                '1.1.1.1',
                                'tls://1.1.1.1:853',
                                'tls://8.8.8.8:853'
                            ];
                            dirty = true;
                        }

                        // Fake-IP range if missing
                        if (config['dns']['enhanced-mode'] === 'fake-ip' && !config['dns']['fake-ip-range']) {
                            config['dns']['fake-ip-range'] = '198.18.0.1/16';
                            dirty = true;
                        }
                    }

                    if (dirty) {
                        content = yaml.dump(config);
                    }
                }

                localPath = path.join(this.profilesDir, `${id}.yaml`);
                fs.writeFileSync(localPath, content);
                console.log('[Store] Profile saved to:', localPath);
            } catch (e) {
                console.error('Failed to download profile:', e);
                throw e;
            }
        } else {
            // It's a local file path already
            localPath = url;
            try {
                const content = fs.readFileSync(url, 'utf-8');
                try {
                    const config: any = yaml.load(content);
                    if (config && typeof config === 'object') {
                        let dirty = false;
                        if (!config['external-controller']) {
                            config['external-controller'] = '127.0.0.1:9092';
                            dirty = true;
                        }
                        if (dirty) {
                            const newContent = yaml.dump(config);
                            const destPath = path.join(this.profilesDir, `${id}.yaml`);
                            fs.writeFileSync(destPath, newContent);
                            localPath = destPath;
                        } else {
                            // Copy anyway for consistency
                            const destPath = path.join(this.profilesDir, `${id}.yaml`);
                            fs.writeFileSync(destPath, content);
                            localPath = destPath;
                        }
                    }
                } catch (e) {
                    const destPath = path.join(this.profilesDir, `${id}.yaml`);
                    fs.writeFileSync(destPath, content);
                    localPath = destPath;
                }
            } catch (e) {
                console.error('Failed to process local file:', e);
                localPath = url;
            }
        }

        const newProfile: Profile = {
            id,
            name,
            url,
            localPath,
            active: profiles.length === 0, // Make active if it's the first one
            updated: Date.now(),
            userInfo
        };

        profiles.push(newProfile);

        this.store.set('profiles', profiles);
        return { profiles, newProfile };
    }

    deleteProfile(id: string) {
        let profiles = this.getProfiles();
        const profile = profiles.find(p => p.id === id);
        if (profile && profile.localPath && profile.localPath.includes(this.profilesDir)) {
            try {
                if (fs.existsSync(profile.localPath)) {
                    fs.unlinkSync(profile.localPath);
                }
            } catch (e) {
                console.error('Failed to delete local file', e);
            }
        }

        profiles = profiles.filter(p => p.id !== id);
        this.store.set('profiles', profiles);
        return profiles;
    }

    updateProfile(id: string, data: Partial<Profile>) {
        const profiles = this.getProfiles();
        const index = profiles.findIndex(p => p.id === id);
        if (index !== -1) {
            profiles[index] = { ...profiles[index], ...data };

            if (data.active) {
                profiles.forEach(p => {
                    if (p.id !== id) p.active = false;
                });
            }

            this.store.set('profiles', profiles);
        }
        return profiles;
    }

    // Refresh a remote profile (re-download and update userInfo)
    async refreshProfile(id: string): Promise<{ success: boolean; error?: string }> {
        const profiles = this.getProfiles();
        const profile = profiles.find(p => p.id === id);

        if (!profile) return { success: false, error: 'Profile not found' };
        if (!profile.url.startsWith('http')) return { success: false, error: 'Not a remote profile' };

        try {
            const axios = (await import('axios')).default;
            const response = await axios.get(profile.url, {
                headers: { 'User-Agent': 'ClashMeta/1.18.0' },
                timeout: 30000,
                responseType: 'text'
            });

            // Parse Subscription Info
            const subInfoStr = response.headers['subscription-userinfo'];
            let userInfo = profile.userInfo;
            if (subInfoStr) {
                try {
                    const parts = Array.isArray(subInfoStr) ? subInfoStr[0].split(';') : subInfoStr.split(';');
                    const info: any = {};
                    parts.forEach((p: string) => {
                        const [k, v] = p.trim().split('=');
                        if (k && v) info[k] = parseInt(v, 10);
                    });
                    userInfo = info;
                } catch (e) { }
            }

            // Parse and save content
            let content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // Try YAML parse, fallback to Base64
            let config: any = null;
            try {
                config = yaml.load(content);
            } catch (e) {
                try {
                    const decoded = Buffer.from(content, 'base64').toString('utf-8');
                    config = yaml.load(decoded);
                    content = decoded;
                } catch (decodeErr) {
                    return { success: false, error: 'Invalid config format' };
                }
            }

            // Inject settings (CRITICAL: same as addProfile)
            if (config && typeof config === 'object') {
                const settings = this.getSettings();

                // Force mixed-port
                config['mixed-port'] = settings.mixedPort;

                // Force allow-lan
                config['allow-lan'] = settings.allowLan;

                // Bind address
                if (config['bind-address'] === undefined) {
                    config['bind-address'] = '*';
                }

                // IPv6
                if (config['ipv6'] === undefined) {
                    config['ipv6'] = false;
                }

                // TCP Concurrent
                if (config['tcp-concurrent'] === undefined) {
                    config['tcp-concurrent'] = true;
                }

                // Unified Delay
                if (config['unified-delay'] === undefined) {
                    config['unified-delay'] = true;
                }

                // Log level
                if (!config['log-level'] || !['info', 'debug', 'warning', 'error', 'silent'].includes(config['log-level'])) {
                    config['log-level'] = 'info';
                }

                // Mode
                if (!config['mode']) {
                    config['mode'] = 'rule';
                }

                // TUN Mode
                if (settings.tunMode) {
                    config['tun'] = {
                        enable: true,
                        stack: 'system',
                        'auto-route': true,
                        'auto-detect-interface': true,
                        'dns-hijack': ['any:53']
                    };
                    if (!config['dns']) config['dns'] = {};
                    config['dns']['enable'] = true;
                    config['dns']['enhanced-mode'] = 'fake-ip';
                    config['dns']['ipv6'] = false;
                    config['dns']['listen'] = '0.0.0.0:1053';

                    if (!config['dns']['nameserver'] || config['dns']['nameserver'].length === 0) {
                        config['dns']['nameserver'] = ['223.5.5.5', '114.114.114.114', '8.8.8.8', '1.1.1.1'];
                        config['dns']['fallback'] = ['8.8.8.8', '1.1.1.1', 'tls://1.1.1.1:853'];
                    }

                    if (!config['dns']['fake-ip-range']) {
                        config['dns']['fake-ip-range'] = '198.18.0.1/16';
                    }
                }
                content = yaml.dump(config);
            }

            // Write to file
            fs.writeFileSync(profile.localPath, content);

            // Update profile metadata
            const index = profiles.findIndex(p => p.id === id);
            if (index !== -1) {
                profiles[index].updated = Date.now();
                profiles[index].userInfo = userInfo;
                this.store.set('profiles', profiles);
            }

            console.log('[Store] Refreshed profile:', profile.name);
            return { success: true };
        } catch (e: any) {
            console.error('[Store] Failed to refresh profile:', e.message);
            return { success: false, error: e.message };
        }
    }

    async parseProfile(id: string) {
        const profile = this.getProfiles().find(p => p.id === id);
        if (!profile) throw new Error('Profile not found');

        if (!profile.localPath) throw new Error('Profile has no local path');

        try {
            const content = fs.readFileSync(profile.localPath, 'utf-8');
            const config = yaml.load(content);
            return config;
        } catch (e) {
            console.error('Failed to parse YAML:', e);
            throw e;
        }
    }

    getSettings() {
        return this.store.get('settings');
    }

    updateSettings(data: Partial<Settings>) {
        const settings = this.getSettings();
        const newSettings = { ...settings, ...data };
        this.store.set('settings', newSettings);
        return newSettings;
    }

    // Regenerate the active profile's config file with current settings (TUN, ports, etc)
    async regenerateActiveProfile(): Promise<string | null> {
        const profiles = this.getProfiles();
        const activeProfile = profiles.find(p => p.active);
        if (!activeProfile) return null;

        const settings = this.getSettings();

        try {
            // Read original content
            let content: string;
            if (activeProfile.url.startsWith('http')) {
                // Re-download from URL
                const axios = (await import('axios')).default;
                const resp = await axios.get(activeProfile.url, { timeout: 30000 });
                content = typeof resp.data === 'string' ? resp.data : yaml.dump(resp.data);

                // Update Subscription Info if present
                const subInfoStr = resp.headers['subscription-userinfo'];
                if (subInfoStr) {
                    try {
                        const parts = subInfoStr.split(';');
                        const info: any = {};
                        parts.forEach((p: string) => {
                            const [k, v] = p.trim().split('=');
                            if (k && v) info[k] = parseInt(v, 10);
                        });
                        activeProfile.userInfo = info;
                        // Save updated profile info to store
                        const allProfiles = this.getProfiles();
                        const idx = allProfiles.findIndex(p => p.id === activeProfile.id);
                        if (idx !== -1) {
                            allProfiles[idx].userInfo = info;
                            this.store.set('profiles', allProfiles);
                        }
                    } catch (e) { }
                }
            } else {
                // Read from original local path or cached
                content = fs.readFileSync(activeProfile.localPath, 'utf-8');
            }

            const config: any = yaml.load(content) || {};

            // Inject standard settings
            if (config['allow-lan'] === undefined) {
                config['allow-lan'] = settings.allowLan;
            }

            // TUN Mode handling
            if (settings.tunMode) {
                config['tun'] = {
                    enable: true,
                    stack: 'system',
                    'auto-route': true,
                    'auto-detect-interface': true,
                    'dns-hijack': ['any:53']
                };

                // Ensure DNS config for TUN
                if (!config['dns']) config['dns'] = {};
                config['dns']['enable'] = true;
                config['dns']['enhanced-mode'] = 'fake-ip';
                config['dns']['listen'] = '0.0.0.0:1053';
                config['dns']['fake-ip-range'] = '198.18.0.1/16';
                if (!config['dns']['nameserver'] || config['dns']['nameserver'].length === 0) {
                    config['dns']['nameserver'] = ['223.5.5.5', '114.114.114.114', '8.8.8.8', '1.1.1.1'];
                    config['dns']['fallback'] = ['8.8.8.8', '1.1.1.1', 'tls://1.1.1.1:853'];
                }
            } else {
                // Remove TUN config when disabled
                delete config['tun'];
            }

            // Write updated config
            const newContent = yaml.dump(config);
            fs.writeFileSync(activeProfile.localPath, newContent);
            console.log('[Store] Regenerated active profile with TUN:', settings.tunMode);

            return activeProfile.localPath;
        } catch (e) {
            console.error('[Store] Failed to regenerate profile:', e);
            return null;
        }
    }
}
