import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { findProjectRoot } from '../utils/paths.js';

const PLIST_LABEL = 'com.coworker.mcp';
const SYSTEMD_SERVICE = 'coworker';

function getCoworkerBinary(): string {
  try {
    const which = execSync('which coworker', { encoding: 'utf-8' }).trim();
    if (which) return which;
  } catch {}
  return process.argv[1];
}

function getNodeBinary(): string {
  return process.execPath;
}

function getProjectDir(): string {
  const root = findProjectRoot();
  if (root) return root;
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

/**
 * Build the ProgramArguments / ExecStart command parts for the service.
 *
 * Critical: `which coworker` typically returns a shell-script wrapper installed
 * by npm/pnpm/yarn (e.g. /Users/foo/Library/pnpm/coworker). Invoking `node`
 * against a shell wrapper produces:
 *
 *   SyntaxError: missing ) after argument list
 *
 * because Node tries to parse shell as JavaScript. The wrapper is already
 * executable and finds its own node via its shebang. So:
 *
 *   - If coworkerBin ends in .js / .mjs / .cjs → use `node <file> start`
 *   - Otherwise (shell wrapper, .cmd, native binary) → use `<bin> start` directly
 *
 * Regression history: the unconditional `node` prefix broke every globally
 * installed user on macOS/Linux from 0.1.0-alpha.1 through alpha.3.
 * Fixed in alpha.4.
 */
export function buildServiceArgs(coworkerBin: string, nodeBin: string): string[] {
  const isJsFile = /\.(c|m)?js$/i.test(coworkerBin);
  if (isJsFile) {
    return [nodeBin, coworkerBin, 'start'];
  }
  return [coworkerBin, 'start'];
}

export function generatePlist(coworkerBin: string, nodeBin: string, projectDir: string, logFile: string): string {
  const nodeBinDir = dirname(nodeBin);
  const pathValue = `/usr/local/bin:/usr/bin:/bin:${nodeBinDir}`;
  const args = buildServiceArgs(coworkerBin, nodeBin);
  const argsXml = args.map((a) => `    <string>${a}</string>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${projectDir}</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
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
  const execStart = buildServiceArgs(coworkerBin, nodeBin).join(' ');

  return `[Unit]
Description=Coworker MCP Server
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
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

  execSync(`launchctl load "${plistPath}"`);

  // POST-INSTALL VERIFICATION (2026-04-18 fix):
  // Previously the install reported success as soon as `launchctl load` returned,
  // which succeeds even if the service immediately crashes. Now we wait briefly
  // and confirm a PID is present before declaring victory — and if the service
  // died at startup, surface the log tail so the user knows what happened.
  const running = waitForRunning(2000);
  if (!running) {
    console.log('Coworker service was installed but failed to start.\n');
    console.log('Most recent log output:');
    console.log('\u2500'.repeat(40));
    try {
      const logTail = execSync(`tail -30 "${logFile}"`, { encoding: 'utf-8' });
      console.log(logTail || '(log file is empty)');
    } catch {
      console.log('(could not read log file)');
    }
    console.log('\u2500'.repeat(40));
    console.log('\nFix the cause above, then run: coworker restart-service');
    process.exitCode = 1;
    return;
  }

  console.log('Coworker installed as a background service.\n');
  console.log('  \u2713 Starts automatically on login');
  console.log('  \u2713 Running now (PID confirmed)');
  console.log('  \u2713 Auto-restart on crash (KeepAlive)\n');
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    ~/.coworker/logs/coworker.log');
  console.log('  Restart: coworker restart-service');
  console.log('  Stop:    coworker uninstall-service');
}

function installSystemd(coworkerBin: string, nodeBin: string, projectDir: string): void {
  const unitPath = getSystemdPath();
  const unitContent = generateSystemdUnit(coworkerBin, nodeBin, projectDir);

  ensureDir(dirname(unitPath));
  writeFileSync(unitPath, unitContent);

  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SYSTEMD_SERVICE}`);
  execSync(`systemctl --user start ${SYSTEMD_SERVICE}`);

  const running = waitForRunning(2000);
  if (!running) {
    console.log('Coworker service was installed but failed to start.\n');
    console.log('Recent journal output:');
    console.log('\u2500'.repeat(40));
    try {
      const logTail = execSync(`journalctl --user -u ${SYSTEMD_SERVICE} -n 30 --no-pager`, { encoding: 'utf-8' });
      console.log(logTail);
    } catch {
      console.log('(could not read journal)');
    }
    console.log('\u2500'.repeat(40));
    console.log('\nFix the cause above, then run: coworker restart-service');
    process.exitCode = 1;
    return;
  }

  console.log('Coworker installed as a background service.\n');
  console.log('  \u2713 Starts automatically on login');
  console.log('  \u2713 Running now (confirmed active)');
  console.log('  \u2713 Auto-restart on crash (Restart=always)\n');
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    journalctl --user -u coworker -f');
  console.log('  Restart: coworker restart-service');
  console.log('  Stop:    coworker uninstall-service');
}

// --- Restart (new in 2026-04-18 fix) ---

export async function restartService(): Promise<void> {
  const os = platform();

  if (os !== 'darwin' && os !== 'linux') {
    console.log(`Service management is not supported on ${os}.`);
    process.exit(1);
  }

  const status = checkServiceStatus();
  if (!status.installed) {
    console.log('Coworker service is not installed.');
    console.log('  \u2192 Run: coworker install-service');
    process.exit(1);
  }

  if (os === 'darwin') {
    const plistPath = getPlistPath();
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
    } catch {}
    execSync(`launchctl load "${plistPath}"`);
  } else {
    execSync(`systemctl --user restart ${SYSTEMD_SERVICE}`);
  }

  const running = waitForRunning(2000);
  if (running) {
    console.log('Coworker service restarted.');
    console.log('  \u2713 Running now');
    console.log('\n  Re-toggle the Coworker connector in Cowork settings');
    console.log('  (turn off, turn on) so it re-establishes the MCP transport.');
  } else {
    console.log('Coworker service failed to start after restart.\n');
    console.log('Check logs:');
    if (os === 'darwin') {
      console.log('  tail -50 ~/.coworker/logs/coworker.log');
    } else {
      console.log('  journalctl --user -u coworker -n 50 --no-pager');
    }
    process.exitCode = 1;
  }
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
  console.log('  \u2713 Service stopped');
  console.log('  \u2713 Service file removed');
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
  console.log('  \u2713 Service stopped');
  console.log('  \u2713 Service file removed');
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

// --- Helper: wait for service to be running ---

/**
 * Poll checkServiceStatus() every 200ms up to `timeoutMs` and return true
 * as soon as the service reports running. Returns false if it never started.
 * Used by install/restart flows to avoid reporting success on a service
 * that immediately crashed.
 */
function waitForRunning(timeoutMs: number): boolean {
  const pollMs = 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (checkServiceStatus().running) return true;
    const sleepFor = Math.min(pollMs, deadline - Date.now());
    if (sleepFor > 0) {
      // Synchronous sleep — we're in a CLI install/restart path, blocking is fine
      execSync(`sleep ${sleepFor / 1000}`);
    }
  }
  return false;
}
