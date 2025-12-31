const fs = require('fs');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
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

    console.log('Downloading Windows Binary...');
    const winUrl = "https://github.com/Dreamacro/clash/releases/download/v1.18.0/clash-windows-amd64-v1.18.0.zip";
    const zipPath = path.join(binDir, 'clash.zip');

    try {
        await downloadFile(winUrl, zipPath);
        console.log('Unzipping with adm-zip...');

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(binDir, true);

        // Rename
        const extracted = path.join(binDir, 'clash-windows-amd64-v1.18.0.exe');
        const target = path.join(binDir, 'clash.exe');

        if (fs.existsSync(extracted)) {
            fs.renameSync(extracted, target);
            console.log('Renamed to clash.exe');
        } else {
            console.error('Extracted file not found:', extracted);
        }

        // Clean up
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        console.log('Windows binary prepared successfully.');

    } catch (e) {
        console.error('Failed to download/extract binary:', e);
        process.exit(1);
    }
}

main();
