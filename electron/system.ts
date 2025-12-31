import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICES = ['Wi-Fi', 'Ethernet', 'Thunderbolt Bridge'];

export async function setSystemProxy(enable: boolean, port: number) {
    const platform = process.platform;

    if (platform === 'darwin') {
        // On disable, we want to turn off ALL services to ensure cleanup
        // On enable, we detect the active one
        const ALL_SERVICES = ['Wi-Fi', 'Ethernet', 'USB 10/100/1000 LAN', 'Thunderbolt Bridge'];

        if (!enable) {
            // DISABLE: Turn off proxy for ALL known services
            console.log('[SystemProxy] Disabling proxy for all services...');
            for (const service of ALL_SERVICES) {
                try {
                    await execAsync(`networksetup -setwebproxystate "${service}" off`);
                    await execAsync(`networksetup -setsecurewebproxystate "${service}" off`);
                    await execAsync(`networksetup -setsocksfirewallproxystate "${service}" off`);
                } catch (e) {
                    // Service might not exist, ignore
                }
            }
            console.log('[SystemProxy] Disabled for all services');
            return;
        }

        // ENABLE: Detect active service and enable proxy
        try {
            // macOS: Dynamically find the active service (the one with the default route)
            // 1. Get default interface (e.g., en0)
            const { stdout: routeOut } = await execAsync('route get default | grep interface');
            const interfaceMatch = routeOut.match(/interface:\s+(\w+)/);
            if (!interfaceMatch) {
                console.error('Could not find default interface, using fallback');
                // Fallback: enable on Wi-Fi
                await execAsync(`networksetup -setwebproxy "Wi-Fi" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setwebproxystate "Wi-Fi" on`);
                await execAsync(`networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsecurewebproxystate "Wi-Fi" on`);
                await execAsync(`networksetup -setsocksfirewallproxy "Wi-Fi" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsocksfirewallproxystate "Wi-Fi" on`);
                console.log('[SystemProxy] Enabled for Wi-Fi (fallback)');
                return;
            }
            const activeInterface = interfaceMatch[1];

            // 2. Map interface to Service Name (e.g., en0 -> Wi-Fi)
            const { stdout: portsOut } = await execAsync('networksetup -listallhardwareports');
            const parts = portsOut.split('Hardware Port: ');
            let activeService = '';
            for (const part of parts) {
                if (part.includes(`Device: ${activeInterface}`)) {
                    activeService = part.split('\n')[0].trim();
                    break;
                }
            }

            if (!activeService) {
                console.log(`Could not map interface ${activeInterface} to a service name, using Wi-Fi`);
                activeService = 'Wi-Fi';
            }

            console.log(`[SystemProxy] Detected active service: ${activeService} (Device: ${activeInterface})`);

            // Enable HTTP/HTTPS/SOCKS5 proxies
            await execAsync(`networksetup -setwebproxy "${activeService}" 127.0.0.1 ${port}`);
            await execAsync(`networksetup -setwebproxystate "${activeService}" on`);
            await execAsync(`networksetup -setsecurewebproxy "${activeService}" 127.0.0.1 ${port}`);
            await execAsync(`networksetup -setsecurewebproxystate "${activeService}" on`);
            await execAsync(`networksetup -setsocksfirewallproxy "${activeService}" 127.0.0.1 ${port}`);
            await execAsync(`networksetup -setsocksfirewallproxystate "${activeService}" on`);
            console.log(`[SystemProxy] Enabled for ${activeService} on port ${port}`);
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
