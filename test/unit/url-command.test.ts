import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { url } from '../../src/cli/url.js';

describe('coworker url command', () => {
  let tmpDir: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-url-'));
    mkdirSync(join(tmpDir, '.coworker'), { recursive: true });
    origCwd = process.cwd();
    process.chdir(tmpDir);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('reads URL from tunnel-url.txt when quick tunnel', async () => {
    writeFileSync(join(tmpDir, '.coworker', 'tunnel-url.txt'), 'https://test-abc.trycloudflare.com/mcp', 'utf-8');
    await url();
    expect(logSpy).toHaveBeenCalledWith('https://test-abc.trycloudflare.com/mcp');
  });

  it('errors when tunnel-url.txt is missing and no named tunnel', async () => {
    await expect(url()).rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Server not running'));
  });

  it('errors when not inside a coworker project', async () => {
    rmSync(join(tmpDir, '.coworker'), { recursive: true });
    await expect(url()).rejects.toThrow('process.exit(1)');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No .coworker'));
  });
});
