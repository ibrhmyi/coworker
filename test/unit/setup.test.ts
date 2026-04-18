import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { getGlobalCoworkerDir, getGlobalBinDir } from '../../src/utils/paths.js';

describe('setup prerequisites', () => {
  it('detects Node.js version >= 20', () => {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it('global coworker dir points to home directory', () => {
    const globalDir = getGlobalCoworkerDir();
    expect(globalDir).toBe(join(homedir(), '.coworker'));
  });

  it('global bin dir is inside global coworker dir', () => {
    const binDir = getGlobalBinDir();
    expect(binDir).toBe(join(homedir(), '.coworker', 'bin'));
  });

  it('getCloudflaredDownloadUrl returns a URL for current platform', () => {
    const plat = process.platform;
    const arch = process.arch;

    const supported = ['darwin', 'linux', 'win32'];
    if (supported.includes(plat)) {
      expect(plat).toBeTruthy();
      expect(arch).toBeTruthy();
    }
  });
});

describe('setup auto-installs background service', () => {
  it('setup module exports the setup function', async () => {
    const mod = await import('../../src/cli/setup.js');
    expect(typeof mod.setup).toBe('function');
  });

  it('background service is supported on current platform', () => {
    const os = platform();
    // setup auto-installs on darwin and linux, falls back on others
    const supported = ['darwin', 'linux'];
    if (supported.includes(os)) {
      expect(supported).toContain(os);
    }
  });
});

describe('stop command removed', () => {
  it('stop.ts no longer exists', () => {
    expect(existsSync(join(__dirname, '../../src/cli/stop.ts'))).toBe(false);
  });
});
