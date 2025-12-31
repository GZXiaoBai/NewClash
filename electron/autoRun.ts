import { app } from 'electron';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const appName = 'NewClash';
const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

// Windows Task XML Template
function getTaskXml(): string {
    const exePath = process.execPath;
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT3S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>3</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${exePath}"</Command>
    </Exec>
  </Actions>
</Task>
`;
}

export async function checkAutoRun(): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            const { stdout } = await execPromise(
                `chcp 437 && %SystemRoot%\\System32\\schtasks.exe /query /tn "${appName}"`
            );
            return stdout.includes(appName);
        }

        if (process.platform === 'darwin') {
            const { stdout } = await execPromise(
                `osascript -e 'tell application "System Events" to get the name of every login item'`
            );
            const exePath = process.execPath;
            const appBundleName = exePath.split('.app')[0]?.split('/').pop() || appName;
            return stdout.includes(appBundleName);
        }

        if (process.platform === 'linux') {
            const homeDir = app.getPath('home');
            const desktopFile = path.join(homeDir, '.config', 'autostart', `${appName.toLowerCase()}.desktop`);
            return fs.existsSync(desktopFile);
        }
    } catch (e) {
        return false;
    }
    return false;
}

export async function enableAutoRun(): Promise<void> {
    if (process.platform === 'win32') {
        const tmpDir = app.getPath('temp');
        const taskFilePath = path.join(tmpDir, `${appName}.xml`);
        fs.writeFileSync(taskFilePath, '\ufeff' + getTaskXml(), { encoding: 'utf16le' });

        try {
            await execPromise(
                `%SystemRoot%\\System32\\schtasks.exe /create /tn "${appName}" /xml "${taskFilePath}" /f`
            );
        } catch (e) {
            // Try with PowerShell UAC
            await execPromise(
                `powershell -NoProfile -Command "Start-Process schtasks -Verb RunAs -ArgumentList '/create', '/tn', '${appName}', '/xml', '${taskFilePath}', '/f' -WindowStyle Hidden"`
            );
        }
    }

    if (process.platform === 'darwin') {
        const exePath = process.execPath;
        const appPath = exePath.split('.app')[0] + '.app';
        await execPromise(
            `osascript -e 'tell application "System Events" to make login item at end with properties {path:"${appPath}", hidden:false}'`
        );
    }

    if (process.platform === 'linux') {
        const homeDir = app.getPath('home');
        const autostartDir = path.join(homeDir, '.config', 'autostart');

        if (!fs.existsSync(autostartDir)) {
            fs.mkdirSync(autostartDir, { recursive: true });
        }

        const desktopContent = `[Desktop Entry]
Name=${appName}
Exec=${process.execPath} %U
Terminal=false
Type=Application
Icon=${appName.toLowerCase()}
StartupWMClass=${appName.toLowerCase()}
Comment=NewClash Proxy Client
Categories=Network;Utility;
`;
        const desktopFile = path.join(autostartDir, `${appName.toLowerCase()}.desktop`);
        fs.writeFileSync(desktopFile, desktopContent);
    }
}

export async function disableAutoRun(): Promise<void> {
    if (process.platform === 'win32') {
        try {
            await execPromise(
                `%SystemRoot%\\System32\\schtasks.exe /delete /tn "${appName}" /f`
            );
        } catch (e) {
            await execPromise(
                `powershell -NoProfile -Command "Start-Process schtasks -Verb RunAs -ArgumentList '/delete', '/tn', '${appName}', '/f' -WindowStyle Hidden"`
            );
        }
    }

    if (process.platform === 'darwin') {
        const exePath = process.execPath;
        const appBundleName = exePath.split('.app')[0]?.split('/').pop() || appName;
        await execPromise(
            `osascript -e 'tell application "System Events" to delete login item "${appBundleName}"'`
        );
    }

    if (process.platform === 'linux') {
        const homeDir = app.getPath('home');
        const desktopFile = path.join(homeDir, '.config', 'autostart', `${appName.toLowerCase()}.desktop`);
        if (fs.existsSync(desktopFile)) {
            fs.unlinkSync(desktopFile);
        }
    }
}
