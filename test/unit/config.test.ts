import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, getDefaultConfig } from '../../src/core/config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-config-'));
    mkdirSync(join(tmpDir, '.coworker'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    rmSync(join(tmpDir, '.coworker'), { recursive: true, force: true });
    mkdirSync(join(tmpDir, '.coworker'), { recursive: true });
    const config = loadConfig(tmpDir);
    expect(config.claude.binary_path).toBe('claude');
    expect(config.claude.default_timeout_seconds).toBe(600);
    expect(config.server.enable_tunnel).toBe(true);
    expect(config.limits.max_concurrent_tasks).toBe(5);
  });

  it('loads valid YAML and merges with defaults', () => {
    writeFileSync(join(tmpDir, '.coworker', 'config.yaml'), `
version: 1
claude:
  default_timeout_seconds: 300
server:
  port: 8080
`, 'utf-8');

    const config = loadConfig(tmpDir);
    expect(config.claude.default_timeout_seconds).toBe(300);
    expect(config.server.port).toBe(8080);
    // Defaults still apply for unset fields
    expect(config.claude.binary_path).toBe('claude');
    expect(config.server.enable_tunnel).toBe(true);
  });

  it('throws clear error on invalid field', () => {
    writeFileSync(join(tmpDir, '.coworker', 'config.yaml'), `
claude:
  default_timeout_seconds: "not a number"
`, 'utf-8');

    expect(() => loadConfig(tmpDir)).toThrow('Invalid config.yaml');
    expect(() => loadConfig(tmpDir)).toThrow('default_timeout_seconds');
  });

  it('handles empty config file gracefully', () => {
    writeFileSync(join(tmpDir, '.coworker', 'config.yaml'), '', 'utf-8');
    const config = loadConfig(tmpDir);
    expect(config.claude.binary_path).toBe('claude');
  });

  it('getDefaultConfig returns valid defaults', () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.claude.default_max_turns).toBe(20);
    expect(config.summary.mode).toBe('heuristic');
  });
});
