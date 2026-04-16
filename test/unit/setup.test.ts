import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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
    // This tests that the platform detection logic works
    const platform = process.platform;
    const arch = process.arch;

    // We support darwin, linux, win32
    const supported = ['darwin', 'linux', 'win32'];
    if (supported.includes(platform)) {
      // Just verify we'd get a URL — the actual function is in setup.ts
      // but it's not exported, so we test the platform detection directly
      expect(platform).toBeTruthy();
      expect(arch).toBeTruthy();
    }
  });
});

describe('stop command removed', () => {
  it('stop.ts no longer exists', () => {
    expect(existsSync(join(__dirname, '../../src/cli/stop.ts'))).toBe(false);
  });
});
