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
}

interface Settings {
    theme: 'dark' | 'light' | 'system';
    mixedPort: number;
    allowLan: boolean;
    systemProxy: boolean;
    tunMode: boolean;
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
                    mixedPort: 7890,
                    allowLan: false,
                    systemProxy: false,
                    tunMode: false
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

        if (url.startsWith('http')) {
            try {
                // Download content
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'ClashMeta/1.18.0' } // fake UA to ensure we get yaml
                });
                if (!response.ok) throw new Error('Network response was not ok');
                let content = await response.text();

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

                    // Always enforce our standard controller port so the UI can connect
                    config['external-controller'] = '127.0.0.1:9090';
                    dirty = true;

                    if (!config['mixed-port'] && !config['port']) {
                        config['mixed-port'] = settings.mixedPort || 7890;
                        dirty = true;
                    }
                    if (config['allow-lan'] === undefined) {
                        config['allow-lan'] = settings.allowLan;
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

                        // Force enable and basic settings if not present or to ensure compatibility
                        if (!config['dns']['enable']) {
                            config['dns']['enable'] = true;
                            dirty = true;
                        }
                        if (!config['dns']['enhanced-mode']) {
                            config['dns']['enhanced-mode'] = 'fake-ip';
                            dirty = true;
                        }
                        if (!config['dns']['listen']) {
                            config['dns']['listen'] = '0.0.0.0:1053';
                            dirty = true;
                        }
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
                            config['external-controller'] = '127.0.0.1:9090';
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
            updated: Date.now()
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
}
