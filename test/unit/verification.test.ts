import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { loadConfig, getDefaultConfig } from '../../src/core/config.js';

/**
 * Tests for auto-verification configuration and command execution logic.
 * The actual verification loop in dispatcher.ts uses execSync + runClaudeCode,
 * so we test the config layer and command execution behavior separately.
 */

describe('verification config', () => {
  let tmpDir: string;
  let coworkerDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-verify-'));
    coworkerDir = join(tmpDir, '.coworker');
    mkdirSync(coworkerDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults verification to disabled', () => {
    const config = getDefaultConfig();
    expect(config.verification.enabled).toBe(false);
    expect(config.verification.commands).toEqual([]);
    expect(config.verification.max_retries).toBe(2);
    expect(config.verification.timeout_seconds).toBe(60);
  });

  it('loads verification config from yaml', () => {
    writeFileSync(
      join(coworkerDir, 'config.yaml'),
      `version: 1
verification:
  enabled: true
  commands:
    - "pnpm typecheck"
    - "pnpm test"
  max_retries: 3
  timeout_seconds: 120
`,
      'utf-8',
    );

    const config = loadConfig(tmpDir);
    expect(config.verification.enabled).toBe(true);
    expect(config.verification.commands).toEqual(['pnpm typecheck', 'pnpm test']);
    expect(config.verification.max_retries).toBe(3);
    expect(config.verification.timeout_seconds).toBe(120);
  });

  it('merges partial verification config with defaults', () => {
    writeFileSync(
      join(coworkerDir, 'config.yaml'),
      `version: 1
verification:
  enabled: true
  commands:
    - "npm test"
`,
      'utf-8',
    );

    const config = loadConfig(tmpDir);
    expect(config.verification.enabled).toBe(true);
    expect(config.verification.commands).toEqual(['npm test']);
    expect(config.verification.max_retries).toBe(2); // default
    expect(config.verification.timeout_seconds).toBe(60); // default
  });
});

describe('verification command execution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-vexec-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passing command returns zero exit code', () => {
    // Simulates what runVerificationCommands does internally
    const result = execSync('echo ok', { cwd: tmpDir, encoding: 'utf-8' });
    expect(result.trim()).toBe('ok');
  });

  it('failing command throws with stderr', () => {
    expect(() => {
      execSync('exit 1', { cwd: tmpDir, encoding: 'utf-8', shell: '/bin/bash' });
    }).toThrow();
  });

  it('command timeout is respected', () => {
    expect(() => {
      execSync('sleep 10', { cwd: tmpDir, timeout: 100, encoding: 'utf-8' });
    }).toThrow();
  });
});
