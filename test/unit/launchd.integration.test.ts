/**
 * Integration test: actually load the generated plist into launchctl and
 * verify the service stays running for more than a trivial interval.
 *
 * Guarded by:
 *   - process.platform === 'darwin' (launchctl only exists on macOS)
 *   - process.env.INTEGRATION === '1' (don't run on every pnpm test)
 *
 * Uses a throwaway label (com.coworker.mcp.integration-test) to avoid
 * clobbering a real install.
 *
 * This is the test that would have caught both alpha.3's SyntaxError crash
 * AND alpha.4's ERR_UNKNOWN_FILE_EXTENSION crash, because neither survived
 * being loaded by the real launchd.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
// NOTE: This file lives at test/unit/launchd.integration.test.ts for test-runner
// discovery, but only actually runs when INTEGRATION=1 on macOS.
import { resolveDistIndex } from '../../src/cli/service.js';

const shouldRun = process.platform === 'darwin' && process.env.INTEGRATION === '1';
const describeMaybe = shouldRun ? describe : describe.skip;

const TEST_LABEL = 'com.coworker.mcp.integration-test';

// Isolated port so this test doesn't collide with a real running service on
// the default port. Randomized to reduce flakiness across parallel test runs.
const TEST_PORT = 18000 + Math.floor(Math.random() * 1000);

function generateTestPlist(distIndex: string, nodeBin: string, logFile: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${TEST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${distIndex}</string>
    <string>start</string>
    <string>--port</string>
    <string>${TEST_PORT}</string>
  </array>
  <key>KeepAlive</key>
  <false/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>COWORKER_DISABLE_TUNNEL</key>
    <string>1</string>
  </dict>
</dict>
</plist>`;
}

function unload(plistPath: string): void {
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
  } catch {}
}

function listLabel(): string {
  try {
    return execSync(`launchctl list ${TEST_LABEL} 2>/dev/null`, { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

function sleep(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}

describeMaybe('launchd integration', () => {
  let tmpDir: string | null = null;
  let plistPath: string | null = null;

  afterEach(() => {
    if (plistPath && existsSync(plistPath)) {
      unload(plistPath);
      unlinkSync(plistPath);
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    plistPath = null;
    tmpDir = null;
  });

  it('generated plist loads and Node successfully starts the entry point', () => {
    // The critical regression check: launchd must be able to load the plist
    // AND Node must be able to load dist/index.js without throwing. If Node
    // fails to parse the entry (Bug A: SyntaxError on shell wrapper) or refuses
    // to load it (Bug B: ERR_UNKNOWN_FILE_EXTENSION on extensionless ESM), no
    // PID will ever be reported.
    //
    // We don't assert the service stays up for an extended time — that's a
    // different concern (tunnel startup, port collision, etc.) which is
    // validated separately by the live service running on the machine.

    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-integ-'));
    const distIndex = resolveDistIndex();
    const nodeBin = process.execPath;
    const logFile = join(tmpDir, 'service.log');
    plistPath = join(tmpDir, 'com.coworker.mcp.integration-test.plist');

    writeFileSync(plistPath, generateTestPlist(distIndex, nodeBin, logFile));

    execSync(`launchctl load "${plistPath}"`);

    // Poll for PID for up to 6s
    let seenPid = false;
    for (let i = 0; i < 30; i++) {
      sleep(200);
      const list = listLabel();
      if (list && /"PID"\s*=\s*\d+/.test(list) && !/"PID"\s*=\s*0/.test(list)) {
        seenPid = true;
        break;
      }
    }

    if (!seenPid) {
      const finalList = listLabel();
      const log = existsSync(logFile) ? readFileSync(logFile, 'utf-8').slice(-3000) : '(no log)';
      throw new Error(
        `Service never reported a PID within 6s — Node failed to load dist/index.js.\n\nlaunchctl dict:\n${finalList}\n\nLog tail:\n${log}`,
      );
    }

    // Service started successfully. Record the launchctl state for visibility.
    const finalList = listLabel();
    expect(finalList).toContain(TEST_LABEL);
    expect(finalList).toContain('ProgramArguments');
  }, 20_000);
});
