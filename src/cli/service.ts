import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { findProjectRoot } from '../utils/paths.js';

const PLIST_LABEL = 'com.coworker.mcp';
const SYSTEMD_SERVICE = 'coworker';

/**
 * Locate this package's compiled dist/index.js.
 *
 * service.ts compiles to dist/cli/service.js; dist/index.js sits at ../index.js
 * relative to it. We also fall back to walking up to a coworker-mcp
 * package.json so the function works when tests import from src/.
 *
 * Why this matters (alpha.5 fix):
 *   - In alpha.3 we passed a shell-wrapper into `node`, which crashed.
 *   - In alpha.4 we invoked the shell-wrapper directly, but the wrapper is
 *     usually an extensionless file with `#!/usr/bin/env node`. Launchd's
 *     PATH resolves to an older Node (e.g. v20), which refuses extensionless
 *     ESM → ERR_UNKNOWN_FILE_EXTENSION.
 *   - Alpha.5: skip the wrapper entirely, target dist/index.js (a plain .js
 *     file) with an explicit Node binary (process.execPath). Deterministic.
 */
export function resolveDistIndex(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);

  // Compiled/installed case: dist/cli/service.js → dist/index.js
  const adjacent = join(thisDir, '..', 'index.js');
  if (existsSync(adjacent)) return adjacent;

  // From-source case: walk up looking for coworker-mcp package.json, then dist/index.js
  let dir = thisDir;
  for (let i = 0; i < 6; i++) {
    const pkgJson = join(dir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8')) as { name?: string };
        if (pkg.name === 'coworker-mcp') {
          const distPath = join(dir, 'dist', 'index.js');
          if (existsSync(distPath)) return distPath;
          break;
        }
      } catch {}
    }
    dir = dirname(dir);
  }

  throw new Error(
    'Could not locate coworker-mcp dist/index.js. Run `pnpm build` or reinstall the package.',
  );
}

function getNodeBinary(): string {
  // The Node currently executing this code. Guaranteed to exist and be
  // compatible with the code that just called this function.
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
 * Build the ProgramArguments / ExecStart command parts.
 *
 * Alpha.5: always `[nodeBin, distIndex, 'start']`. distIndex is a plain .js
 * file, so any Node ≥18 can load it regardless of `"type":"module"` or PATH
 * resolution. No shebang, no wrapper, no PATH reliance.
 *
 * Regression history:
 *   - Alpha.1–3: unconditional `node <shell-wrapper>` → SyntaxError loop.
 *   - Alpha.4: extension-based detection invoked wrappers directly, but
 *     extensionless wrappers + older launchd-Node → ERR_UNKNOWN_FILE_EXTENSION.
 *   - Alpha.5 (this): target dist/index.js directly. See resolveDistIndex().
 */
export function buildServiceArgs(distIndex: string, nodeBin: string): string[] {
  return [nodeBin, distIndex, 'start'];
}

export function generatePlist(distIndex: string, nodeBin: string, projectDir: string, logFile: string): string {
  const nodeBinDir = dirname(nodeBin);
  const pathValue = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${nodeBinDir}`;
  const args = buildServiceArgs(distIndex, nodeBin);
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
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`;
}

// --- Linux systemd ---

function getSystemdPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${SYSTEMD_SERVICE}.service`);
}

export function generateSystemdUnit(distIndex: string, nodeBin: string, projectDir: string): string {
  const nodeBinDir = dirname(nodeBin);
  const pathValue = `/usr/local/bin:/usr/bin:/bin:${nodeBinDir}`;
  const execStart = buildServiceArgs(distIndex, nodeBin).join(' ');

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

  const distIndex = resolveDistIndex();
  const nodeBin = getNodeBinary();
  const projectDir = getProjectDir();
  const logDir = getGlobalLogDir();
  const logFile = join(logDir, 'coworker.log');

  ensureDir(logDir);

  if (os === 'darwin') {
    installLaunchd(distIndex, nodeBin, projectDir, logFile);
  } else {
    installSystemd(distIndex, nodeBin, projectDir);
  }
}

function installLaunchd(distIndex: string, nodeBin: string, projectDir: string, logFile: string): void {
  const plistPath = getPlistPath();
  const plistContent = generatePlist(distIndex, nodeBin, projectDir, logFile);

  // Unload existing if present
  if (existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
    } catch {}
  }

  ensureDir(dirname(plistPath));
  writeFileSync(plistPath, plistContent);

  execSync(`launchctl load "${plistPath}"`);

  // POST-INSTALL VERIFICATION:
  // `launchctl load` succeeds even if the service immediately crashes.
  // Poll briefly and confirm a PID is present before declaring victory.
  // If the service died at startup, surface the log tail inline.
  const running = waitForRunning(3000);
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
  console.log(`  Entry:   ${distIndex}`);
  console.log(`  Node:    ${nodeBin}`);
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    ~/.coworker/logs/coworker.log');
  console.log('  Restart: coworker restart-service');
  console.log('  Stop:    coworker uninstall-service');
}

function installSystemd(distIndex: string, nodeBin: string, projectDir: string): void {
  const unitPath = getSystemdPath();
  const unitContent = generateSystemdUnit(distIndex, nodeBin, projectDir);

  ensureDir(dirname(unitPath));
  writeFileSync(unitPath, unitContent);

  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SYSTEMD_SERVICE}`);
  execSync(`systemctl --user start ${SYSTEMD_SERVICE}`);

  const running = waitForRunning(3000);
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
  console.log(`  Entry:   ${distIndex}`);
  console.log(`  Node:    ${nodeBin}`);
  console.log('  Status:  coworker doctor');
  console.log('  Logs:    journalctl --user -u coworker -f');
  console.log('  Restart: coworker restart-service');
  console.log('  Stop:    coworker uninstall-service');
}

// --- Restart ---

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

  const running = waitForRunning(3000);
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

function waitForRunning(timeoutMs: number): boolean {
  const pollMs = 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (checkServiceStatus().running) return true;
    const sleepFor = Math.min(pollMs, deadline - Date.now());
    if (sleepFor > 0) {
      execSync(`sleep ${sleepFor / 1000}`);
    }
  }
  return false;
}
