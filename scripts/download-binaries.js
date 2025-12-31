const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            // Handle redirect
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

async function main() {
    const binDir = path.join(__dirname, '../bin');
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    // Windows Binary
    console.log('Downloading Windows Binary...');
    const winUrl = "https://github.com/Dreamacro/clash/releases/download/v1.18.0/clash-windows-amd64-v1.18.0.zip";
    const zipPath = path.join(binDir, 'clash.zip');

    try {
        await downloadFile(winUrl, zipPath);
        console.log('Unzipping...');
        // Use system unzip or powershell if on windows, or just rely on a library if we had one.
        // Since we are likely in a Node env in CI, we can assume 'unzip' exists on Linux/Mac runners.
        // If this runs on Windows runner, we might need Powershell.
        // NOTE: The previous failure was likely due to `shell: pwsh` context.
        // Let's keep it simple: if we are in this script, we can just use consistent logic.

        if (process.platform === 'win32') {
            execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`);
            // Rename
            const extracted = path.join(binDir, 'clash-windows-amd64-v1.18.0.exe');
            const target = path.join(binDir, 'clash.exe');
            if (fs.existsSync(extracted)) fs.renameSync(extracted, target);
        } else {
            execSync(`unzip -o '${zipPath}' -d '${binDir}'`);
            const extracted = path.join(binDir, 'clash-windows-amd64-v1.18.0.exe');
            const target = path.join(binDir, 'clash.exe');
            if (fs.existsSync(extracted)) fs.renameSync(extracted, target);
        }

        // Clean up
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        console.log('Windows binary prepared.');

    } catch (e) {
        console.error('Failed to download binary:', e);
        process.exit(1);
    }
}

main();
