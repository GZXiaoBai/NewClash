import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICES = ['Wi-Fi', 'Ethernet', 'Thunderbolt Bridge'];

export async function setSystemProxy(enable: boolean, port: number) {
    const platform = process.platform;

    if (platform === 'darwin') {
        try {
            for (const service of SERVICES) {
                if (enable) {
                    // console.log(`Setting proxy for ${service} to 127.0.0.1:${port}`);
                    await execAsync(`networksetup -setwebproxy "${service}" 127.0.0.1 ${port}`);
                    await execAsync(`networksetup -setsecurewebproxy "${service}" 127.0.0.1 ${port}`);
                    await execAsync(`networksetup -setsocksfirewallproxy "${service}" 127.0.0.1 ${port}`);
                } else {
                    // console.log(`Disabling proxy for ${service}`);
                    await execAsync(`networksetup -setwebproxystate "${service}" off`);
                    await execAsync(`networksetup -setsecurewebproxystate "${service}" off`);
                    await execAsync(`networksetup -setsocksfirewallproxystate "${service}" off`);
                }
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
