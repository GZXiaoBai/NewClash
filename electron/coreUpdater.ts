import axios from 'axios';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createWriteStream, createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import AdmZip from 'adm-zip';

const GITHUB_API = 'https://api.github.com';
const OWNER = 'MetaCubeX';
const REPO = 'mihomo';

// Platform mapping for download URLs
const PLATFORM_MAP: Record<string, string> = {
    'darwin-x64': 'mihomo-darwin-amd64-compatible',
    'darwin-arm64': 'mihomo-darwin-arm64',
    'win32-x64': 'mihomo-windows-amd64-compatible',
    'win32-ia32': 'mihomo-windows-386',
    'win32-arm64': 'mihomo-windows-arm64',
    'linux-x64': 'mihomo-linux-amd64-compatible',
    'linux-arm64': 'mihomo-linux-arm64'
};

export interface CoreVersion {
    tag: string;
    name: string;
    published: string;
    isPrerelease: boolean;
}

export interface CoreUpdateResult {
    success: boolean;
    error?: string;
    version?: string;
}

// Cache for version list
let versionCache: { data: CoreVersion[]; timestamp: number } | null = null;
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

/**
 * Get current installed core version
 */
export async function getCurrentCoreVersion(): Promise<string> {
    const userDataDir = app.getPath('userData');
    const coreDir = path.join(userDataDir, 'core');
    const binaryName = process.platform === 'win32' ? 'clash.exe' : 'clash';
    const binaryPath = path.join(coreDir, binaryName);

    if (!fs.existsSync(binaryPath)) {
        return 'Not Installed';
    }

    try {
        const { execSync } = require('child_process');
        const output = execSync(`"${binaryPath}" -v`, { encoding: 'utf-8', timeout: 5000 });
        // Parse version from output like "Mihomo Meta v1.18.0"
        const match = output.match(/v[\d.]+(-alpha)?(-\d+)?/);
        return match ? match[0] : 'Unknown';
    } catch (e) {
        return 'Unknown';
    }
}

/**
 * Fetch available versions from GitHub
 */
export async function getAvailableVersions(forceRefresh = false): Promise<CoreVersion[]> {
    // Check cache
    if (!forceRefresh && versionCache && Date.now() - versionCache.timestamp < CACHE_EXPIRY) {
        return versionCache.data;
    }

    try {
        const response = await axios.get(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases`, {
            params: { per_page: 20 },
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'NewClash'
            },
            timeout: 15000
        });

        const versions: CoreVersion[] = response.data.map((release: any) => ({
            tag: release.tag_name,
            name: release.name || release.tag_name,
            published: release.published_at,
            isPrerelease: release.prerelease
        }));

        // Update cache
        versionCache = { data: versions, timestamp: Date.now() };
        return versions;
    } catch (e: any) {
        console.error('[CoreUpdater] Failed to fetch versions:', e.message);
        throw new Error(`Failed to fetch versions: ${e.message}`);
    }
}

/**
 * Download and install a specific core version
 */
export async function installCoreVersion(version: string, onProgress?: (progress: number) => void): Promise<CoreUpdateResult> {
    const platform = process.platform;
    const arch = process.arch;
    const key = `${platform}-${arch}`;
    const coreName = PLATFORM_MAP[key];

    if (!coreName) {
        return { success: false, error: `Unsupported platform: ${platform}-${arch}` };
    }

    const isWin = platform === 'win32';
    const ext = isWin ? 'zip' : 'gz';
    const downloadUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${version}/${coreName}-${version}.${ext}`;

    const userDataDir = app.getPath('userData');
    const coreDir = path.join(userDataDir, 'core');
    const tempFile = path.join(coreDir, `temp-core.${ext}`);
    const targetFile = isWin ? 'clash.exe' : 'clash';
    const targetPath = path.join(coreDir, targetFile);

    // Ensure core directory exists
    if (!fs.existsSync(coreDir)) {
        fs.mkdirSync(coreDir, { recursive: true });
    }

    try {
        console.log(`[CoreUpdater] Downloading from: ${downloadUrl}`);

        // Download file with progress
        const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            onDownloadProgress: (progressEvent) => {
                if (progressEvent.total && onProgress) {
                    onProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
                }
            }
        });

        // Write to temp file
        fs.writeFileSync(tempFile, Buffer.from(response.data));
        console.log('[CoreUpdater] Download complete, extracting...');

        // Backup existing binary
        const backupPath = path.join(coreDir, `${targetFile}.backup`);
        if (fs.existsSync(targetPath)) {
            fs.copyFileSync(targetPath, backupPath);
        }

        // Extract
        if (ext === 'zip') {
            const zip = new AdmZip(tempFile);
            const entries = zip.getEntries();
            const entry = entries.find(e => e.entryName.includes(coreName));
            if (entry) {
                zip.extractEntryTo(entry, coreDir, false, true, false, targetFile);
            } else {
                throw new Error('Core binary not found in archive');
            }
        } else {
            // .gz file
            await new Promise<void>((resolve, reject) => {
                const readStream = createReadStream(tempFile);
                const writeStream = createWriteStream(targetPath);

                readStream
                    .pipe(createGunzip())
                    .pipe(writeStream)
                    .on('finish', () => {
                        // Set executable permission on Unix
                        if (!isWin) {
                            fs.chmodSync(targetPath, 0o755);
                        }
                        resolve();
                    })
                    .on('error', reject);
            });
        }

        // Cleanup temp file
        fs.unlinkSync(tempFile);

        // Remove backup if successful
        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
        }

        console.log(`[CoreUpdater] Successfully installed version ${version}`);
        return { success: true, version };
    } catch (e: any) {
        console.error('[CoreUpdater] Installation failed:', e.message);

        // Restore backup if exists
        const backupPath = path.join(coreDir, `${targetFile}.backup`);
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, targetPath);
            fs.unlinkSync(backupPath);
        }

        return { success: false, error: e.message };
    }
}

/**
 * Check if update is available
 */
export async function checkForUpdate(): Promise<{ hasUpdate: boolean; latestVersion?: string; currentVersion?: string }> {
    try {
        const [versions, current] = await Promise.all([
            getAvailableVersions(),
            getCurrentCoreVersion()
        ]);

        if (versions.length === 0) {
            return { hasUpdate: false, currentVersion: current };
        }

        // Find latest stable version
        const latestStable = versions.find(v => !v.isPrerelease);
        const latest = latestStable || versions[0];

        // Compare versions
        const hasUpdate = current !== latest.tag && current !== 'Not Installed' && current !== 'Unknown';

        return {
            hasUpdate,
            latestVersion: latest.tag,
            currentVersion: current
        };
    } catch (e) {
        return { hasUpdate: false };
    }
}
