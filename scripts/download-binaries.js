const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

// Robust download with proper redirect handling (GitHub uses multiple redirects)
function downloadFile(url, dest, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects'));
        }

        const protocol = url.startsWith('https') ? https : http;

        console.log(`[Download] Fetching: ${url}`);

        const request = protocol.get(url, (response) => {
            // Handle redirects (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(response.statusCode)) {
                const redirectUrl = response.headers.location;
                if (!redirectUrl) {
                    return reject(new Error('Redirect without location header'));
                }
                console.log(`[Download] Redirecting to: ${redirectUrl}`);
                return downloadFile(redirectUrl, dest, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                return reject(new Error(`HTTP ${response.statusCode}`));
            }

            const file = fs.createWriteStream(dest);
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`[Download] Saved to: ${dest}`);
                resolve();
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });

        request.on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });

        request.setTimeout(120000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

async function main() {
    const binDir = path.join(__dirname, '../bin');
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }

    console.log('=== Downloading Mihomo (Clash Meta) Windows Binary ===');

    // Use Mihomo (Clash Meta) instead of deprecated Clash
    // Format: .gz file which needs to be decompressed
    const version = 'v1.19.18';
    const winUrl = `https://github.com/MetaCubeX/mihomo/releases/download/${version}/mihomo-windows-amd64-${version}.zip`;
    const zipPath = path.join(binDir, 'mihomo.zip');

    try {
        await downloadFile(winUrl, zipPath);

        console.log('[Unzip] Extracting...');

        // Use Node.js built-in unzip via child_process on Windows
        const { execSync } = require('child_process');

        // Windows has tar command that can extract zip files since Windows 10
        execSync(`tar -xf "${zipPath}" -C "${binDir}"`, { stdio: 'inherit' });

        // Find the extracted exe
        const files = fs.readdirSync(binDir);
        console.log('[Unzip] Contents:', files);

        const mihomoExe = files.find(f => f.startsWith('mihomo') && f.endsWith('.exe'));
        if (mihomoExe) {
            const target = path.join(binDir, 'clash.exe');
            fs.renameSync(path.join(binDir, mihomoExe), target);
            console.log(`[Rename] ${mihomoExe} -> clash.exe`);
        } else {
            throw new Error('Mihomo exe not found after extraction');
        }

        // Clean up
        fs.unlinkSync(zipPath);
        console.log('[Cleanup] Removed zip file');
        console.log('=== Mihomo binary prepared successfully! ===');

    } catch (e) {
        console.error('=== FAILED ===');
        console.error(e);
        process.exit(1);
    }
}

main();
