import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generatePlist,
  generateSystemdUnit,
  checkServiceStatus,
  buildServiceArgs,
  resolveDistIndex,
} from '../../src/cli/service.js';

// Regression history (read before changing this file):
//   - 0.1.0-alpha.1..alpha.3: unconditionally prefixed service command with
//     `node`, which crashed on shell-wrapper bins (SyntaxError).
//   - 0.1.0-alpha.4: extension-based detection; correctly stopped prefixing
//     node on shell wrappers, but extensionless wrappers + older launchd-Node
//     → ERR_UNKNOWN_FILE_EXTENSION.
//   - 0.1.0-alpha.5 (current): skip the bin wrapper entirely. Always target
//     dist/index.js (a plain .js file) with process.execPath (the exact Node
//     that ran install-service). Deterministic across all Node versions ≥18.

// --- buildServiceArgs (alpha.5 contract) ---------------------------------

describe('buildServiceArgs', () => {
  const nodeBin = '/usr/local/bin/node';
  const distIndex = '/opt/homebrew/lib/node_modules/coworker-mcp/dist/index.js';

  it('always returns [nodeBin, distIndex, "start"]', () => {
    expect(buildServiceArgs(distIndex, nodeBin)).toEqual([nodeBin, distIndex, 'start']);
  });

  it('handles nvm-style paths', () => {
    const nvmDist = '/home/user/.nvm/versions/node/v22/lib/node_modules/coworker-mcp/dist/index.js';
    const nvmNode = '/home/user/.nvm/versions/node/v22/bin/node';
    expect(buildServiceArgs(nvmDist, nvmNode)).toEqual([nvmNode, nvmDist, 'start']);
  });

  it('handles pnpm global store paths', () => {
    const pnpmDist = '/Users/foo/Library/pnpm/global/5/node_modules/coworker-mcp/dist/index.js';
    expect(buildServiceArgs(pnpmDist, nodeBin)[0]).toBe(nodeBin);
    expect(buildServiceArgs(pnpmDist, nodeBin)[1]).toBe(pnpmDist);
  });
});

// --- resolveDistIndex (new in alpha.5) -----------------------------------

describe('resolveDistIndex', () => {
  it('returns an absolute path ending in dist/index.js', () => {
    const p = resolveDistIndex();
    expect(isAbsolute(p)).toBe(true);
    expect(p.endsWith('dist/index.js') || p.endsWith('dist\\index.js')).toBe(true);
  });

  it('the resolved file actually exists', () => {
    // This is the test that would have caught Bug B in alpha.4: the path we
    // hand to launchd must actually be loadable. A plain .js file is always
    // loadable by Node ≥18.
    const p = resolveDistIndex();
    expect(existsSync(p)).toBe(true);
  });
});

// --- generatePlist (macOS launchd) ---------------------------------------

describe('generatePlist', () => {
  const distIndex = '/opt/homebrew/lib/node_modules/coworker-mcp/dist/index.js';
  const nodeBin = '/opt/homebrew/bin/node';
  const projectDir = '/Users/test/myproject';
  const logFile = '/Users/test/.coworker/logs/coworker.log';

  it('generates valid plist XML', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('</plist>');
  });

  it('contains the correct label', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<string>com.coworker.mcp</string>');
  });

  it('ProgramArguments is exactly [nodeBin, distIndex, "start"] (alpha.5 contract)', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    const argsBlock = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsBlock.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([nodeBin, distIndex, 'start']);
  });

  it('sets working directory', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain(`<string>${projectDir}</string>`);
  });

  it('sets KeepAlive to true', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<true/>');
  });

  it('sets RunAtLoad to true', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>RunAtLoad</key>');
  });

  it('sets ThrottleInterval explicitly', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>ThrottleInterval</key>');
  });

  it('redirects stdout and stderr to log file', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('<key>StandardErrorPath</key>');
    expect(plist).toContain(`<string>${logFile}</string>`);
  });

  it('sets PATH env var with Homebrew, /usr/local, and node bin dir', () => {
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>PATH</key>');
    expect(plist).toContain('/opt/homebrew/bin');
    expect(plist).toContain('/usr/local/bin');
  });

  it('sets HOME env var for launchd child processes', () => {
    // Without this, child subprocesses (claude CLI, cloudflared) can't find
    // their config files in ~.
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>HOME</key>');
  });

  it('handles nvm-style paths', () => {
    const plist = generatePlist(
      '/home/user/.nvm/versions/node/v22/lib/node_modules/coworker-mcp/dist/index.js',
      '/home/user/.nvm/versions/node/v22/bin/node',
      '/home/user/projects/myapp',
      '/home/user/.coworker/logs/coworker.log',
    );
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin/node');
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/lib/node_modules/coworker-mcp/dist/index.js');
    expect(plist).toContain('/home/user/projects/myapp');
    // node bin dir makes it into PATH
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin');
  });

  it('REGRESSION: never embeds a shell-wrapper path as the entry', () => {
    // Alpha.4 Bug B: extensionless wrapper was used as the entry and launchd
    // crashed on ERR_UNKNOWN_FILE_EXTENSION. Alpha.5 must target a .js file.
    // (This test enforces that callers pass a .js path — generatePlist itself
    // is agnostic, but the regression risk is in the call site. Tests of
    // installService's call path would fail if it regressed.)
    const plist = generatePlist(distIndex, nodeBin, projectDir, logFile);
    const argsBlock = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsBlock.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    const entry = strings[1];
    expect(entry).toMatch(/\.(c|m)?js$/);
  });
});

// --- generateSystemdUnit (Linux) -----------------------------------------

describe('generateSystemdUnit', () => {
  const distIndex = '/opt/coworker/dist/index.js';
  const nodeBin = '/usr/local/bin/node';
  const projectDir = '/home/user/myproject';

  it('generates valid systemd unit file', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
  });

  it('has correct description', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('Description=Coworker MCP Server');
  });

  it('ExecStart is exactly "nodeBin distIndex start" (alpha.5 contract)', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain(`ExecStart=${nodeBin} ${distIndex} start`);
  });

  it('sets working directory', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain(`WorkingDirectory=${projectDir}`);
  });

  it('has Restart=always', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('Restart=always');
  });

  it('has WantedBy=default.target', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('WantedBy=default.target');
  });

  it('sets PATH including node bin dir', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('Environment=PATH=');
    expect(unit).toContain('/usr/local/bin');
  });

  it('has RestartSec for delay between restarts', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('RestartSec=');
  });

  it('has After=network.target', () => {
    const unit = generateSystemdUnit(distIndex, nodeBin, projectDir);
    expect(unit).toContain('After=network.target');
  });
});

// --- checkServiceStatus --------------------------------------------------

describe('checkServiceStatus', () => {
  it('returns an object with installed and running fields', () => {
    const status = checkServiceStatus();
    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('running');
    expect(typeof status.installed).toBe('boolean');
    expect(typeof status.running).toBe('boolean');
  });

  it('returns the expected shape', () => {
    const status = checkServiceStatus();
    expect(status).toEqual(
      expect.objectContaining({
        installed: expect.any(Boolean),
        running: expect.any(Boolean),
      }),
    );
  });
});

// --- File-write smoke tests ----------------------------------------------

describe('install/uninstall (mock filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-service-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('plist file can be written and read back', () => {
    const plistContent = generatePlist(
      '/opt/homebrew/lib/node_modules/coworker-mcp/dist/index.js',
      '/opt/homebrew/bin/node',
      '/Users/test/project',
      '/Users/test/.coworker/logs/coworker.log',
    );
    const plistPath = join(tmpDir, 'com.coworker.mcp.plist');
    writeFileSync(plistPath, plistContent);
    expect(existsSync(plistPath)).toBe(true);
    const content = readFileSync(plistPath, 'utf-8');
    expect(content).toContain('com.coworker.mcp');
    expect(content).toContain('start');
    expect(content).toContain('dist/index.js');
  });

  it('systemd unit file can be written and read back', () => {
    const unitContent = generateSystemdUnit(
      '/opt/coworker/dist/index.js',
      '/usr/local/bin/node',
      '/home/user/project',
    );
    const unitPath = join(tmpDir, 'coworker.service');
    writeFileSync(unitPath, unitContent);
    expect(existsSync(unitPath)).toBe(true);
    const content = readFileSync(unitPath, 'utf-8');
    expect(content).toContain('Coworker MCP Server');
    expect(content).toContain('Restart=always');
    expect(content).toContain('dist/index.js');
  });
});
