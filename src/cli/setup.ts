import { existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { init } from './init.js';
import { start } from './start.js';
import { tunnelSetup } from './tunnel-setup.js';
import { getGlobalBinDir, ensureGlobalDirs } from '../utils/paths.js';

function checkNodeVersion(): boolean {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) {
    console.log(`✓ Node.js ${process.versions.node}`);
    return true;
  }
  console.log(`✗ Node.js 20+ required. You have ${process.versions.node}. Upgrade at https://nodejs.org`);
  return false;
}

function checkClaudeCode(): boolean {
  try {
    const path = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (!path) throw new Error();

    let version = '';
    try {
      version = execSync('claude --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      // Version check failed — might need auth, but binary exists
    }

    console.log(`✓ Claude Code found: ${path}${version ? ` (${version})` : ''}`);
    return true;
  } catch {
    console.log('✗ Claude Code not found. Install it: https://docs.anthropic.com/en/docs/claude-code');
    return false;
  }
}

function findCloudflaredInPath(): string | undefined {
  try {
    const path = execSync('which cloudflared', { encoding: 'utf-8' }).trim();
    return path || undefined;
  } catch {
    return undefined;
  }
}

function findCloudflaredLocal(): string | undefined {
  const path = join(getGlobalBinDir(), 'cloudflared');
  return existsSync(path) ? path : undefined;
}

function getCloudflaredDownloadUrl(): { url: string; isTarball: boolean } | undefined {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz', isTarball: true };
    }
    return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz', isTarball: true };
  }

  if (platform === 'linux') {
    if (arch === 'arm64') {
      return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64', isTarball: false };
    }
    return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64', isTarball: false };
  }

  if (platform === 'win32') {
    return { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', isTarball: false };
  }

  return undefined;
}

async function downloadCloudflared(): Promise<boolean> {
  const downloadInfo = getCloudflaredDownloadUrl();
  if (!downloadInfo) {
    console.log('✗ cloudflared not found, and auto-download not supported for this platform.');
    console.log('  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    return false;
  }

  console.log('  Downloading cloudflared...');
  ensureGlobalDirs();
  const binDir = getGlobalBinDir();
  const targetPath = join(binDir, 'cloudflared');

  try {
    if (downloadInfo.isTarball) {
      // Download tarball, extract, move binary
      execSync(
        `curl -sL "${downloadInfo.url}" | tar xz -C "${binDir}"`,
        { encoding: 'utf-8', timeout: 120_000 },
      );
    } else {
      // Direct binary download
      execSync(
        `curl -sL -o "${targetPath}" "${downloadInfo.url}"`,
        { encoding: 'utf-8', timeout: 120_000 },
      );
    }

    chmodSync(targetPath, 0o755);

    if (!existsSync(targetPath)) {
      throw new Error('Binary not found after download');
    }

    console.log(`✓ cloudflared downloaded to ${targetPath}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ cloudflared download failed: ${msg}`);
    console.log('  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    return false;
  }
}

async function checkCloudflared(): Promise<boolean> {
  const systemPath = findCloudflaredInPath();
  if (systemPath) {
    console.log(`✓ cloudflared found: ${systemPath}`);
    return true;
  }

  const localPath = findCloudflaredLocal();
  if (localPath) {
    console.log(`✓ cloudflared found: ${localPath}`);
    return true;
  }

  // Auto-download
  return downloadCloudflared();
}

export async function setup(directory?: string, opts: { stable?: boolean } = {}): Promise<void> {
  console.log('Welcome to Coworker — turn Cowork into an autonomous PM for Claude Code.\n');
  console.log('Running setup checks...\n');

  // 1. Check Node.js
  if (!checkNodeVersion()) {
    process.exit(1);
  }

  // 2. Check Claude Code
  if (!checkClaudeCode()) {
    process.exit(1);
  }

  // 3. Check/install cloudflared
  const hasCloudflared = await checkCloudflared();
  if (!hasCloudflared) {
    console.log('\nSetup will continue without tunnel support. You can install cloudflared later.\n');
  }

  // 4. Init project
  const projectDir = resolve(directory ?? process.cwd());
  console.log('');
  await init(projectDir);

  // 5. If --stable, run named tunnel setup before starting
  if (opts.stable) {
    console.log('\nRunning named tunnel setup for a permanent URL...\n');
    // tunnelSetup may process.exit(1) if cloudflared not logged in — that's intentional
    await tunnelSetup({});
    console.log('');
  } else {
    console.log('\nUsing quick tunnel (URL changes on restart).');
    console.log("For a permanent URL, stop and run:  coworker setup --stable\n");
  }

  // 6. Start server (blocks until Ctrl+C)
  console.log("Tip: Run 'coworker install-service' to run Coworker in the background.");
  console.log('     No terminal needed — starts automatically on login.\n');
  await start({});
}
