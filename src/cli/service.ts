import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { findProjectRoot } from '../utils/paths.js';

const PLIST_LABEL = 'com.coworker.mcp';
const SYSTEMD_SERVICE = 'coworker';

function getCoworkerBinary(): string {
  // Try to find the coworker binary
  try {
    const which = execSync('which coworker', { encoding: 'utf-8' }).trim();
    if (which) return which;
  } catch {}

  // Fallback: resolve from this file's location (dist/index.js)
  return process.argv[1];
}

function getNodeBinary(): string {
  return process.execPath;
}

function getProjectDir(): string {
  const root = findProjectRoot();
  if (root) return root;
  // Fall back to cwd
  return process.cwd();
}

function getGlobalLogDir(): string {
  return join(homedir(), '.coworker', 'logs');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- macOS launchd ---

function getPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);
}

export function generatePlist(coworkerBin: string, nodeBin: string, projectDir: string, logFile: string): string {
  const nodeBinDir = dirname(nodeBin);
  // Include common paths and the node binary's directory
  const pathValue = `/usr/local/bin:/usr/bin:/bin:${nodeBinDir}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${coworkerBin}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectDir}</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathValue}</string>
  </dict>
</dict>
</plist>`;
}

// --- Linux systemd ---

function getSystemdPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${SYSTEMD_SERVICE}.service`);
}

export function generateSystemdUnit(coworkerBin: string, nodeBin: string, projectDir: string): string {
  const nodeBinDir = dirname(nodeBin);
  const pathValue = `/usr/local/bin:/usr/bin:/bin:${nodeBinDir}`;

  return `[Unit]
Description=Coworker MCP Server
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${coworkerBin} start
WorkingDirectory=${projectDir}
Restart=always
RestartSec=5
Environment=PATH=${pathValue}

[Install]
WantedBy=default.target`;
}

// --- Install ---

export async function installService(): Promise<void> {
  const os = platform();

  if (os !== 'darwin' && os !== 'linux') {
    console.log(`Service installation is not supported on ${os}.`);
    console.log('Supported platforms: macOS (launchd), Linux (systemd).');
    process.exit(1);
  }

  const coworkerBin = getCoworkerBinary();
  const nodeBin = getNodeBinary();
  const projectDir = getProjectDir();
  const logDir = getGlobalLogDir();
  const logFile = join(logDir, 'coworker.log');

  ensureDir(logDir);

  if (os === 'darwin') {
    installLaunchd(coworkerBin, nodeBin, projectDir, logFile);
  } else {
    installSystemd(coworkerBin, nodeBin, projectDir);
  }
}

function installLaunchd(coworkerBin: string, nodeBin: string, projectDir: string, logFile: string): void {
  const plistPath = getPlistPath();
  const plistContent = generatePlist(coworkerBin, nodeBin, projectDir, logFile);

  // Unload existing if present
  if (existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
    } catch {}
  }

  ensureDir(dirname(plistPath));
  writeFileSync(plistPath, plistContent);

  // Load and start
  execSync(`launchctl load "${plistPath}"`);

  console.log('Coworker installed as a background service.\n');
  console.log('  ✓ Starts automatically on login');
  console.log('  ✓ Running now\n');
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    ~/.coworker/logs/coworker.log');
  console.log('  Stop:    coworker uninstall-service');
}

function installSystemd(coworkerBin: string, nodeBin: string, projectDir: string): void {
  const unitPath = getSystemdPath();
  const unitContent = generateSystemdUnit(coworkerBin, nodeBin, projectDir);

  ensureDir(dirname(unitPath));
  writeFileSync(unitPath, unitContent);

  // Reload, enable, and start
  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SYSTEMD_SERVICE}`);
  execSync(`systemctl --user start ${SYSTEMD_SERVICE}`);

  console.log('Coworker installed as a background service.\n');
  console.log('  ✓ Starts automatically on login');
  console.log('  ✓ Running now\n');
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    journalctl --user -u coworker -f');
  console.log('  Stop:    coworker uninstall-service');
}

// --- Uninstall ---

export async function uninstallService(): Promise<void> {
  const os = platform();

  if (os !== 'darwin' && os !== 'linux') {
    console.log(`Service uninstallation is not supported on ${os}.`);
    process.exit(1);
  }

  if (os === 'darwin') {
    uninstallLaunchd();
  } else {
    uninstallSystemd();
  }
}

function uninstallLaunchd(): void {
  const plistPath = getPlistPath();

  if (!existsSync(plistPath)) {
    console.log('Coworker service is not installed.');
    return;
  }

  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
  } catch {}
  unlinkSync(plistPath);

  console.log('Coworker background service removed.\n');
  console.log('  ✓ Service stopped');
  console.log('  ✓ Service file removed');
}

function uninstallSystemd(): void {
  const unitPath = getSystemdPath();

  if (!existsSync(unitPath)) {
    console.log('Coworker service is not installed.');
    return;
  }

  try {
    execSync(`systemctl --user stop ${SYSTEMD_SERVICE}`, { stdio: 'ignore' });
  } catch {}
  try {
    execSync(`systemctl --user disable ${SYSTEMD_SERVICE}`, { stdio: 'ignore' });
  } catch {}
  unlinkSync(unitPath);
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  } catch {}

  console.log('Coworker background service removed.\n');
  console.log('  ✓ Service stopped');
  console.log('  ✓ Service file removed');
}

// --- Status check (for doctor) ---

export function checkServiceStatus(): { installed: boolean; running: boolean } {
  const os = platform();

  if (os === 'darwin') {
    return checkLaunchdStatus();
  } else if (os === 'linux') {
    return checkSystemdStatus();
  }

  return { installed: false, running: false };
}

function checkLaunchdStatus(): { installed: boolean; running: boolean } {
  const plistPath = getPlistPath();
  if (!existsSync(plistPath)) {
    return { installed: false, running: false };
  }

  let running = false;
  try {
    const output = execSync(`launchctl list ${PLIST_LABEL} 2>/dev/null`, { encoding: 'utf-8' });
    // If the command succeeds, the service is loaded. Check PID.
    running = !output.includes('"PID" = 0') && output.includes('"PID"');
  } catch {
    // Not loaded
  }

  return { installed: true, running };
}

function checkSystemdStatus(): { installed: boolean; running: boolean } {
  const unitPath = getSystemdPath();
  if (!existsSync(unitPath)) {
    return { installed: false, running: false };
  }

  let running = false;
  try {
    const output = execSync(`systemctl --user is-active ${SYSTEMD_SERVICE}`, { encoding: 'utf-8' }).trim();
    running = output === 'active';
  } catch {
    // Not active
  }

  return { installed: true, running };
}
