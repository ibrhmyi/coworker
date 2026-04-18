import { existsSync, accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { findProjectRoot, getCoworkerDir, getDbPath, getGlobalBinDir } from '../utils/paths.js';
import { initDb, closeDb, markOrphanedTasks } from '../core/store.js';
import { loadConfig } from '../core/config.js';
import { isCloudflaredLoggedIn, getTunnelId, findCloudflared } from '../server/tunnel.js';
import { checkServiceStatus } from './service.js';

interface Check {
  name: string;
  passed: boolean;
  detail: string;
  hint?: string;
}

export async function doctor(): Promise<void> {
  const checks: Check[] = [];

  // 1. Node.js version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) {
    checks.push({ name: 'node.js', passed: true, detail: `v${process.versions.node}` });
  } else {
    checks.push({
      name: 'node.js',
      passed: false,
      detail: `v${process.versions.node} (20+ required)`,
      hint: 'Upgrade at https://nodejs.org',
    });
  }

  // 2. Claude binary
  try {
    const path = execSync('which claude', { encoding: 'utf-8' }).trim();
    let version = '';
    try {
      version = execSync('claude --version', { encoding: 'utf-8' }).trim();
    } catch {}
    checks.push({ name: 'claude binary', passed: true, detail: `${path} (${version})` });
  } catch {
    checks.push({
      name: 'claude binary',
      passed: false,
      detail: 'not found in PATH',
      hint: 'Install Claude Code: https://docs.anthropic.com/en/docs/claude-code',
    });
  }

  // 3. cloudflared binary (check PATH + ~/.coworker/bin/)
  let cloudflaredFound = false;
  try {
    const path = execSync('which cloudflared', { encoding: 'utf-8' }).trim();
    checks.push({ name: 'cloudflared', passed: true, detail: path });
    cloudflaredFound = true;
  } catch {
    const globalPath = join(getGlobalBinDir(), 'cloudflared');
    if (existsSync(globalPath)) {
      checks.push({ name: 'cloudflared', passed: true, detail: `${globalPath} (auto-downloaded)` });
      cloudflaredFound = true;
    } else {
      checks.push({
        name: 'cloudflared',
        passed: false,
        detail: 'not found in PATH or ~/.coworker/bin/',
        hint: 'Run: coworker setup (auto-downloads), or brew install cloudflared (macOS)',
      });
    }
  }

  // 4. .coworker/ directory
  const projectDir = findProjectRoot();
  if (projectDir) {
    checks.push({ name: '.coworker/ directory', passed: true, detail: getCoworkerDir(projectDir) });
  } else {
    checks.push({
      name: '.coworker/ directory',
      passed: false,
      detail: 'not found in current or parent directories',
      hint: 'Run: coworker init',
    });
  }

  // 5. tasks.db readable/writable
  if (projectDir) {
    const dbPath = getDbPath(projectDir);
    if (existsSync(dbPath)) {
      try {
        initDb(dbPath);
        checks.push({ name: 'tasks.db', passed: true, detail: 'readable and writable' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({
          name: 'tasks.db',
          passed: false,
          detail: msg,
          hint: 'Check file permissions or delete and re-run coworker init',
        });
      }
    } else {
      checks.push({
        name: 'tasks.db',
        passed: false,
        detail: 'file not found',
        hint: 'Run: coworker init',
      });
    }
  } else {
    checks.push({ name: 'tasks.db', passed: false, detail: 'no project found', hint: 'Run: coworker init' });
  }

  // 6. Orphaned tasks
  if (projectDir) {
    try {
      const orphaned = markOrphanedTasks(1);
      if (orphaned === 0) {
        checks.push({ name: 'orphaned tasks', passed: true, detail: 'none found' });
      } else {
        checks.push({ name: 'orphaned tasks', passed: true, detail: `cleaned up ${orphaned} orphaned task(s)` });
      }
    } catch {
      checks.push({ name: 'orphaned tasks', passed: false, detail: 'could not check', hint: 'Database may be locked' });
    }
  } else {
    checks.push({ name: 'orphaned tasks', passed: false, detail: 'no project found', hint: 'Run: coworker init' });
  }

  // 7. Background service
  {
    const service = checkServiceStatus();
    if (service.installed) {
      checks.push({
        name: 'background service',
        passed: true,
        detail: service.running ? 'installed and running' : 'installed but not running',
        hint: service.running ? undefined : 'Run: coworker install-service',
      });
    } else {
      checks.push({
        name: 'background service',
        passed: true,
        detail: 'not installed (optional)',
        hint: 'Run: coworker install-service',
      });
    }
  }

  // 8. config.yaml
  if (projectDir) {
    try {
      loadConfig(projectDir);
      checks.push({ name: 'config.yaml', passed: true, detail: 'valid' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ name: 'config.yaml', passed: false, detail: msg, hint: 'Fix the config file or delete it to use defaults' });
    }
  } else {
    checks.push({ name: 'config.yaml', passed: false, detail: 'no project found', hint: 'Run: coworker init' });
  }

  // 9. STATUS.md and CONTEXT.md
  if (projectDir) {
    const coworkerDir = getCoworkerDir(projectDir);

    const statusPath = join(coworkerDir, 'STATUS.md');
    if (existsSync(statusPath)) {
      try {
        accessSync(statusPath, constants.W_OK);
        checks.push({ name: 'STATUS.md', passed: true, detail: 'exists and writable' });
      } catch {
        checks.push({ name: 'STATUS.md', passed: false, detail: 'exists but not writable', hint: 'Check file permissions' });
      }
    } else {
      checks.push({ name: 'STATUS.md', passed: false, detail: 'not found', hint: 'Run: coworker init' });
    }

    const contextPath = join(coworkerDir, 'CONTEXT.md');
    if (existsSync(contextPath)) {
      checks.push({ name: 'CONTEXT.md', passed: true, detail: 'exists' });
    } else {
      checks.push({ name: 'CONTEXT.md', passed: false, detail: 'not found', hint: 'Run: coworker init' });
    }
  }

  // 10. Verification commands (if configured)
  if (projectDir) {
    try {
      const config = loadConfig(projectDir);
      if (config.verification.enabled && config.verification.commands.length > 0) {
        for (const cmd of config.verification.commands) {
          const binary = cmd.split(/\s+/)[0];
          try {
            execSync(`which ${binary}`, { encoding: 'utf-8' });
            checks.push({ name: `verification: ${binary}`, passed: true, detail: 'available' });
          } catch {
            checks.push({
              name: `verification: ${binary}`,
              passed: false,
              detail: 'not found in PATH',
              hint: `Verification command "${cmd}" requires "${binary}" to be installed`,
            });
          }
        }
      }
    } catch { /* config already checked above */ }
  }

  // 11. Named tunnel (if configured)
  if (projectDir) {
    try {
      const config = loadConfig(projectDir);
      if (config.server.tunnel_mode === 'named' && config.server.tunnel_name) {
        if (!isCloudflaredLoggedIn()) {
          checks.push({
            name: 'named tunnel auth',
            passed: false,
            detail: 'cloudflared not logged in (no cert.pem)',
            hint: "Run: cloudflared tunnel login",
          });
        } else {
          checks.push({ name: 'named tunnel auth', passed: true, detail: 'cert.pem found' });
          try {
            const binary = findCloudflared();
            const tunnelId = getTunnelId(binary, config.server.tunnel_name);
            if (tunnelId) {
              checks.push({ name: `named tunnel '${config.server.tunnel_name}'`, passed: true, detail: `ID: ${tunnelId}` });
            } else {
              checks.push({
                name: `named tunnel '${config.server.tunnel_name}'`,
                passed: false,
                detail: 'tunnel not found',
                hint: "Run: coworker tunnel-setup",
              });
            }
          } catch {
            checks.push({ name: 'named tunnel', passed: false, detail: 'could not check', hint: 'cloudflared may not be installed' });
          }
        }
      }
    } catch { /* config already checked above */ }
  }

  // Close DB if we opened it
  closeDb();

  // Print results
  console.log('Coworker Doctor');
  console.log('\u2500'.repeat(40));

  let passed = 0;
  for (const check of checks) {
    const icon = check.passed ? '\u2713' : '\u2717';
    console.log(`${icon} ${check.name}: ${check.detail}`);
    if (!check.passed && check.hint) {
      console.log(`  \u2192 ${check.hint}`);
    }
    if (check.passed) passed++;
  }

  console.log(`\n${passed}/${checks.length} checks passed.`);

  if (passed < checks.length) {
    process.exitCode = 1;
  }
}
