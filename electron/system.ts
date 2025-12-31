import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICES = ['Wi-Fi', 'Ethernet', 'Thunderbolt Bridge'];

export async function setSystemProxy(enable: boolean, port: number) {
    const platform = process.platform;

    if (platform === 'darwin') {
        try {
            // macOS: Dynamically find the active service (the one with the default route)
            // 1. Get default interface (e.g., en0)
            const { stdout: routeOut } = await execAsync('route get default | grep interface');
            const interfaceMatch = routeOut.match(/interface:\s+(\w+)/);
            if (!interfaceMatch) {
                console.error('Could not find default interface');
                return;
            }
            const activeInterface = interfaceMatch[1];

            // 2. Map interface to Service Name (e.g., en0 -> Wi-Fi)
            const { stdout: portsOut } = await execAsync('networksetup -listallhardwareports');
            // Output format:
            // Hardware Port: Wi-Fi
            // Device: en0
            // ...
            const parts = portsOut.split('Hardware Port: ');
            let activeService = '';
            for (const part of parts) {
                if (part.includes(`Device: ${activeInterface}`)) {
                    activeService = part.split('\n')[0].trim();
                    break;
                }
            }

            if (!activeService) {
                console.log(`Could not map interface ${activeInterface} to a service name, trying fallback list.`);
                // Fallback to iterating common names if detection fails
                const FALLBACK_SERVICES = ['Wi-Fi', 'Ethernet', 'USB 10/100/1000 LAN', 'Thunderbolt Bridge'];
                for (const service of FALLBACK_SERVICES) {
                    if (enable) {
                        await execAsync(`networksetup -setwebproxy "${service}" 127.0.0.1 ${port}`);
                        await execAsync(`networksetup -setsecurewebproxy "${service}" 127.0.0.1 ${port}`);
                        await execAsync(`networksetup -setsocksfirewallproxy "${service}" 127.0.0.1 ${port}`);
                    } else {
                        await execAsync(`networksetup -setwebproxystate "${service}" off`);
                        await execAsync(`networksetup -setsecurewebproxystate "${service}" off`);
                        await execAsync(`networksetup -setsocksfirewallproxystate "${service}" off`);
                    }
                }
                return;
            }

            console.log(`Detected active service: ${activeService} (Device: ${activeInterface})`);

            if (enable) {
                // Enable HTTP/HTTPS proxies AND set port (must do both)
                await execAsync(`networksetup -setwebproxy "${activeService}" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setwebproxystate "${activeService}" on`);
                await execAsync(`networksetup -setsecurewebproxy "${activeService}" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsecurewebproxystate "${activeService}" on`);
                // SOCKS5 proxy (same port for mixed-port mode)
                await execAsync(`networksetup -setsocksfirewallproxy "${activeService}" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsocksfirewallproxystate "${activeService}" on`);
                console.log(`[SystemProxy] Enabled for ${activeService} on port ${port}`);
            } else {
                await execAsync(`networksetup -setwebproxystate "${activeService}" off`);
                await execAsync(`networksetup -setsecurewebproxystate "${activeService}" off`);
                await execAsync(`networksetup -setsocksfirewallproxystate "${activeService}" off`);
                console.log(`[SystemProxy] Disabled for ${activeService}`);
            }
        } catch (e) {
            console.error('Failed to set macOS system proxy:', e);
        }
    } else if (platform === 'win32') {
        try {
            if (enable) {
                const proxyServer = `127.0.0.1:${port}`;
                const override = "<local>;localhost;127.*";
                console.log(`[Windows] Enabling Proxy: ${proxyServer}`);

                // Enable Proxy
                await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`);
                // Set Proxy Server
                await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f`);
                // Set Proxy Override
                await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${override}" /f`);
            } else {
                console.log(`[Windows] Disabling Proxy`);
                // Disable Proxy
                await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`);
            }
        } catch (e) {
            console.error('Failed to set Windows system proxy:', e);
        }
    }
}
