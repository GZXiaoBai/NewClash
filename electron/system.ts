import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SERVICES = ['Wi-Fi', 'Ethernet', 'Thunderbolt Bridge'];

export async function setSystemProxy(enable: boolean, port: number) {
    if (process.platform !== 'darwin') return; // Only macOS for now

    try {
        for (const service of SERVICES) {
            if (enable) {
                console.log(`Setting proxy for ${service} to 127.0.0.1:${port}`);
                await execAsync(`networksetup -setwebproxy "${service}" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsecurewebproxy "${service}" 127.0.0.1 ${port}`);
                await execAsync(`networksetup -setsocksfirewallproxy "${service}" 127.0.0.1 ${port}`);
            } else {
                console.log(`Disabling proxy for ${service}`);
                await execAsync(`networksetup -setwebproxystate "${service}" off`);
                await execAsync(`networksetup -setsecurewebproxystate "${service}" off`);
                await execAsync(`networksetup -setsocksfirewallproxystate "${service}" off`);
            }
        }
    } catch (e) {
        console.error('Failed to set system proxy:', e);
    }
}
