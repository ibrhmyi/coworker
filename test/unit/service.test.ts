import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { generatePlist, generateSystemdUnit, checkServiceStatus, buildServiceArgs } from '../../src/cli/service.js';

// --- buildServiceArgs (new in alpha.4) -----------------------------------
//
// Regression: 0.1.0-alpha.1..alpha.3 unconditionally prefixed the service
// command with `node`, which crashed every globally-installed user because
// `which coworker` returns a shell wrapper from npm/pnpm/yarn — and node
// can't parse shell as JS. Fixed by detecting the file extension.

describe('buildServiceArgs', () => {
  const nodeBin = '/usr/local/bin/node';

  it('does NOT prefix shell-wrapper binary with node (regression: alpha.3 launchd crash)', () => {
    // What `which coworker` returns when installed via npm/pnpm/yarn globally
    const args = buildServiceArgs('/Users/foo/Library/pnpm/coworker', nodeBin);
    expect(args).toEqual(['/Users/foo/Library/pnpm/coworker', 'start']);
    expect(args).not.toContain(nodeBin);
  });

  it('does NOT prefix bare-binary path (no extension) with node', () => {
    const args = buildServiceArgs('/usr/local/bin/coworker', nodeBin);
    expect(args).toEqual(['/usr/local/bin/coworker', 'start']);
    expect(args).not.toContain(nodeBin);
  });

  it('DOES prefix raw .js file with node (direct dist/index.js install)', () => {
    const args = buildServiceArgs('/path/to/dist/index.js', nodeBin);
    expect(args).toEqual([nodeBin, '/path/to/dist/index.js', 'start']);
  });

  it('DOES prefix .mjs file with node', () => {
    const args = buildServiceArgs('/path/to/index.mjs', nodeBin);
    expect(args).toEqual([nodeBin, '/path/to/index.mjs', 'start']);
  });

  it('DOES prefix .cjs file with node', () => {
    const args = buildServiceArgs('/path/to/index.cjs', nodeBin);
    expect(args).toEqual([nodeBin, '/path/to/index.cjs', 'start']);
  });

  it('is case-insensitive on extension', () => {
    expect(buildServiceArgs('/path/to/INDEX.JS', nodeBin)[0]).toBe(nodeBin);
  });
});

// --- generatePlist (macOS launchd) ---------------------------------------

describe('generatePlist', () => {
  // Default test scenario: globally-installed coworker (shell wrapper).
  // This is what `which coworker` actually returns on a real user's machine.
  const coworkerBin = '/usr/local/bin/coworker';
  const nodeBin = '/usr/local/bin/node';
  const projectDir = '/Users/test/myproject';
  const logFile = '/Users/test/.coworker/logs/coworker.log';

  it('generates valid plist XML', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('</plist>');
  });

  it('contains the correct label', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<string>com.coworker.mcp</string>');
  });

  it('runs the coworker shell-wrapper directly (no node prefix)', () => {
    // REGRESSION (alpha.4): with a non-.js binary, plist must invoke the
    // wrapper directly. Otherwise launchd loops on SyntaxError forever.
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain(`<string>${coworkerBin}</string>`);
    expect(plist).toContain('<string>start</string>');
    // Must NOT have node as the first ProgramArguments entry
    const argsBlock = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsBlock.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([coworkerBin, 'start']);
  });

  it('uses node prefix when coworkerBin is a raw .js file', () => {
    const jsBin = '/opt/coworker/dist/index.js';
    const plist = generatePlist(jsBin, nodeBin, projectDir, logFile);
    const argsBlock = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsBlock.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([nodeBin, jsBin, 'start']);
  });

  it('sets working directory', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain(`<string>${projectDir}</string>`);
  });

  it('sets KeepAlive to true', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('<true/>');
  });

  it('sets RunAtLoad to true', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>RunAtLoad</key>');
  });

  it('sets ThrottleInterval explicitly', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>ThrottleInterval</key>');
  });

  it('redirects stdout and stderr to log file', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('<key>StandardErrorPath</key>');
    expect(plist).toContain(`<string>${logFile}</string>`);
  });

  it('sets PATH environment variable including node bin dir', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);
    expect(plist).toContain('<key>PATH</key>');
    expect(plist).toContain('/usr/local/bin');
  });

  it('handles custom paths (nvm install, raw .js)', () => {
    const plist = generatePlist(
      '/home/user/.nvm/versions/node/v22/lib/node_modules/coworker-mcp/dist/index.js',
      '/home/user/.nvm/versions/node/v22/bin/node',
      '/home/user/projects/myapp',
      '/home/user/.coworker/logs/coworker.log',
    );
    // Raw .js → node prefix should appear
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin/node');
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/lib/node_modules/coworker-mcp/dist/index.js');
    expect(plist).toContain('/home/user/projects/myapp');
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin');
  });
});

// --- generateSystemdUnit (Linux) -----------------------------------------

describe('generateSystemdUnit', () => {
  const coworkerBin = '/usr/local/bin/coworker';
  const nodeBin = '/usr/local/bin/node';
  const projectDir = '/home/user/myproject';

  it('generates valid systemd unit file', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
  });

  it('has correct description', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('Description=Coworker MCP Server');
  });

  it('runs shell-wrapper coworker directly (no node prefix)', () => {
    // REGRESSION (alpha.4): same fix as plist for systemd ExecStart.
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain(`ExecStart=${coworkerBin} start`);
    expect(unit).not.toContain(`ExecStart=${nodeBin}`);
  });

  it('uses node prefix in ExecStart when coworkerBin is a raw .js file', () => {
    const jsBin = '/opt/coworker/dist/index.js';
    const unit = generateSystemdUnit(jsBin, nodeBin, projectDir);
    expect(unit).toContain(`ExecStart=${nodeBin} ${jsBin} start`);
  });

  it('sets working directory', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain(`WorkingDirectory=${projectDir}`);
  });

  it('has Restart=always', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('Restart=always');
  });

  it('has WantedBy=default.target', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('WantedBy=default.target');
  });

  it('sets PATH including node bin dir', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('Environment=PATH=');
    expect(unit).toContain('/usr/local/bin');
  });

  it('has RestartSec for delay between restarts', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
    expect(unit).toContain('RestartSec=');
  });

  it('has After=network.target', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);
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
      '/usr/local/bin/coworker',
      '/usr/local/bin/node',
      '/Users/test/project',
      '/Users/test/.coworker/logs/coworker.log',
    );
    const plistPath = join(tmpDir, 'com.coworker.mcp.plist');
    writeFileSync(plistPath, plistContent);
    expect(existsSync(plistPath)).toBe(true);
    const content = readFileSync(plistPath, 'utf-8');
    expect(content).toContain('com.coworker.mcp');
    expect(content).toContain('start');
  });

  it('systemd unit file can be written and read back', () => {
    const unitContent = generateSystemdUnit(
      '/usr/local/bin/coworker',
      '/usr/local/bin/node',
      '/home/user/project',
    );
    const unitPath = join(tmpDir, 'coworker.service');
    writeFileSync(unitPath, unitContent);
    expect(existsSync(unitPath)).toBe(true);
    const content = readFileSync(unitPath, 'utf-8');
    expect(content).toContain('Coworker MCP Server');
    expect(content).toContain('Restart=always');
  });

  it('plist program arguments are [coworker-wrapper, start] for shell-wrapper case', () => {
    // REGRESSION TEST (alpha.4): the previous assertion expected
    // [node, coworker, start]. That was the bug. The correct behavior
    // is to invoke the shell-wrapper directly so it can find its own node.
    const plist = generatePlist(
      '/usr/local/bin/coworker',
      '/usr/local/bin/node',
      '/Users/test/project',
      '/Users/test/.coworker/logs/coworker.log',
    );

    const argsSection = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsSection.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([
      '/usr/local/bin/coworker',
      'start',
    ]);
  });

  it('plist program arguments are [node, file.js, start] for raw .js case', () => {
    const plist = generatePlist(
      '/opt/coworker/dist/index.js',
      '/usr/local/bin/node',
      '/Users/test/project',
      '/Users/test/.coworker/logs/coworker.log',
    );

    const argsSection = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsSection.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1]);
    expect(strings).toEqual([
      '/usr/local/bin/node',
      '/opt/coworker/dist/index.js',
      'start',
    ]);
  });
});
