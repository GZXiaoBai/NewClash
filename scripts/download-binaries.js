const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');

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

        request.setTimeout(60000, () => {
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

    console.log('=== Downloading Windows Binary ===');
    const winUrl = 'https://github.com/Dreamacro/clash/releases/download/v1.18.0/clash-windows-amd64-v1.18.0.zip';
    const zipPath = path.join(binDir, 'clash.zip');

    try {
        await downloadFile(winUrl, zipPath);

        console.log('[Unzip] Extracting with adm-zip...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(binDir, true);

        // Find and rename the extracted binary
        const extracted = path.join(binDir, 'clash-windows-amd64-v1.18.0.exe');
        const target = path.join(binDir, 'clash.exe');

        if (fs.existsSync(extracted)) {
            fs.renameSync(extracted, target);
            console.log('[Rename] clash-windows-amd64-v1.18.0.exe -> clash.exe');
        } else {
            // List what was extracted
            console.log('[Unzip] Contents:', fs.readdirSync(binDir));
            throw new Error('Expected binary not found after extraction');
        }

        // Clean up
        fs.unlinkSync(zipPath);
        console.log('[Cleanup] Removed zip file');
        console.log('=== Windows binary prepared successfully! ===');

    } catch (e) {
        console.error('=== FAILED ===');
        console.error(e);
        process.exit(1);
    }
}

main();
