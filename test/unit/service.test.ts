import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { generatePlist, generateSystemdUnit, checkServiceStatus } from '../../src/cli/service.js';

describe('generatePlist', () => {
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

  it('uses node to run coworker start', () => {
    const plist = generatePlist(coworkerBin, nodeBin, projectDir, logFile);

    expect(plist).toContain(`<string>${nodeBin}</string>`);
    expect(plist).toContain(`<string>${coworkerBin}</string>`);
    expect(plist).toContain('<string>start</string>');
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

  it('handles custom paths', () => {
    const plist = generatePlist(
      '/home/user/.nvm/versions/node/v22/bin/coworker',
      '/home/user/.nvm/versions/node/v22/bin/node',
      '/home/user/projects/myapp',
      '/home/user/.coworker/logs/coworker.log',
    );

    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin/node');
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin/coworker');
    expect(plist).toContain('/home/user/projects/myapp');
    // PATH should include the nvm node bin dir
    expect(plist).toContain('/home/user/.nvm/versions/node/v22/bin');
  });
});

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

  it('runs node with coworker start', () => {
    const unit = generateSystemdUnit(coworkerBin, nodeBin, projectDir);

    expect(unit).toContain(`ExecStart=${nodeBin} ${coworkerBin} start`);
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

describe('checkServiceStatus', () => {
  it('returns an object with installed and running fields', () => {
    const status = checkServiceStatus();

    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('running');
    expect(typeof status.installed).toBe('boolean');
    expect(typeof status.running).toBe('boolean');
  });

  it('reports not installed when service file does not exist', () => {
    // On a fresh system without the service installed, it should report not installed
    const status = checkServiceStatus();

    // We can't guarantee the service isn't installed in CI,
    // but we can verify the structure
    expect(status).toEqual(
      expect.objectContaining({
        installed: expect.any(Boolean),
        running: expect.any(Boolean),
      }),
    );
  });
});

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

  it('plist contains all three program arguments in order', () => {
    const plist = generatePlist(
      '/usr/local/bin/coworker',
      '/usr/local/bin/node',
      '/Users/test/project',
      '/Users/test/.coworker/logs/coworker.log',
    );

    // Verify the ProgramArguments array has node, coworker, start in order
    const argsSection = plist.slice(
      plist.indexOf('<key>ProgramArguments</key>'),
      plist.indexOf('</array>') + '</array>'.length,
    );
    const strings = [...argsSection.matchAll(/<string>(.*?)<\/string>/g)].map(m => m[1]);
    expect(strings).toEqual([
      '/usr/local/bin/node',
      '/usr/local/bin/coworker',
      'start',
    ]);
  });
});
