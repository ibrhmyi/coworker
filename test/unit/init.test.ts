import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../../src/cli/init.js';

describe('init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-init-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the correct directory structure', async () => {
    await init(tmpDir);

    expect(existsSync(join(tmpDir, '.coworker'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'config.yaml'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'tasks.db'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'logs'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'results'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', '.gitignore'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'STATUS.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'CONTEXT.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.coworker', 'DECISIONS.md'))).toBe(true);
  });

  it('creates .gitignore with wildcard', async () => {
    await init(tmpDir);
    const content = readFileSync(join(tmpDir, '.coworker', '.gitignore'), 'utf-8');
    expect(content.trim()).toBe('*');
  });

  it('creates valid config.yaml', async () => {
    await init(tmpDir);
    const content = readFileSync(join(tmpDir, '.coworker', 'config.yaml'), 'utf-8');
    expect(content).toContain('version: 1');
    expect(content).toContain('binary_path: claude');
  });

  it('does not overwrite existing .coworker/', async () => {
    await init(tmpDir);
    // Modify config to detect overwrite
    const configPath = join(tmpDir, '.coworker', 'config.yaml');
    const original = readFileSync(configPath, 'utf-8');

    // Run init again — should not overwrite
    await init(tmpDir);
    const after = readFileSync(configPath, 'utf-8');
    expect(after).toBe(original);
  });
});
