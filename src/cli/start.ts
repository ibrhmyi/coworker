import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { findProjectRoot, getTunnelUrlFile } from '../utils/paths.js';
import { loadConfig } from '../core/config.js';
import { startServer, shutdownProcesses } from '../server/mcp.js';
import { startTunnel } from '../server/tunnel.js';
import { closeDb } from '../core/store.js';
import { copyToClipboard } from '../utils/clipboard.js';

function readPreviousUrl(projectDir: string): string | undefined {
  const file = getTunnelUrlFile(projectDir);
  if (!existsSync(file)) return undefined;
  try {
    const content = readFileSync(file, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

function writeTunnelUrl(projectDir: string, url: string): void {
  try {
    writeFileSync(getTunnelUrlFile(projectDir), url, 'utf-8');
  } catch { /* non-critical */ }
}

function deleteTunnelUrl(projectDir: string): void {
  try {
    unlinkSync(getTunnelUrlFile(projectDir));
  } catch { /* already gone */ }
}

function printFirstRun(connectorUrl: string, localUrl: string, clipboardOk: boolean): void {
  console.log('\nCoworker is running for the first time!\n');
  console.log(`  Connector URL: ${connectorUrl}`);
  if (clipboardOk) console.log('  ✓ Copied to clipboard!');
  console.log(`  Local URL:     ${localUrl}\n`);
  console.log('  To connect:');
  console.log('  1. Open Claude Desktop \u2192 Settings \u2192 Connectors');
  console.log('  2. Click "Add custom connector"');
  console.log('  3. Name: Coworker');
  console.log(`  4. Paste the URL${clipboardOk ? ' (already on your clipboard)' : ''}`);
  console.log('  5. Save, then toggle Coworker on in your conversation');
  console.log('  6. Say "what tools do you have?" — you should see 6 Coworker tools\n');
  console.log('  ⚡ For a permanent URL that never changes: coworker setup --stable\n');
  console.log('Press Ctrl+C to stop.');
}

function printSubsequentRun(connectorUrl: string, clipboardOk: boolean): void {
  console.log('\nCoworker is running.\n');
  console.log(`  URL: ${connectorUrl}${clipboardOk ? ' (✓ clipboard)' : ''}\n`);
  console.log('Press Ctrl+C to stop.');
}

function printUrlChanged(oldUrl: string, newUrl: string, clipboardOk: boolean): void {
  console.log('\n⚠ Tunnel URL changed from previous session.');
  console.log(`  Old: ${oldUrl}`);
  console.log(`  New: ${newUrl}\n`);
  if (clipboardOk) {
    console.log('  ✓ New URL copied to clipboard. Update your connector in Claude Desktop settings.');
  } else {
    console.log('  Update your connector in Claude Desktop settings with the new URL.');
  }
  console.log('\nPress Ctrl+C to stop.');
}

function isPortInUseError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EADDRINUSE');
}

export async function start(opts: { port?: string }): Promise<void> {
  const projectDir = findProjectRoot();
  if (!projectDir) {
    console.error('No .coworker/ directory found. Run `coworker init` first.');
    process.exit(1);
  }

  const config = loadConfig(projectDir);
  const port = opts.port ? parseInt(opts.port, 10) : config.server.port;

  let server: Awaited<ReturnType<typeof startServer>>['server'];
  let actualPort: number;
  try {
    const started = await startServer(port, projectDir);
    server = started.server;
    actualPort = started.actualPort;
  } catch (err) {
    if (isPortInUseError(err)) {
      console.error(`Port ${port} is already in use. Is another Coworker instance running?`);
      console.error(`Run \`coworker doctor\` or use \`coworker start --port <N>\` to pick a different port.`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`MCP server listening on http://localhost:${actualPort}/mcp`);

  const localUrl = `http://localhost:${actualPort}/mcp`;
  const previousUrl = readPreviousUrl(projectDir);
  let tunnelKill: (() => void) | undefined;

  const tunnelMode = !config.server.enable_tunnel ? 'none' : config.server.tunnel_mode;

  if (tunnelMode !== 'none') {
    try {
      console.log(`Starting Cloudflare tunnel (${tunnelMode})...`);
      const tunnel = await startTunnel({
        localPort: actualPort,
        mode: tunnelMode,
        tunnelName: config.server.tunnel_name || undefined,
      });

      if (tunnel) {
        tunnelKill = tunnel.kill;
        const connectorUrl = `${tunnel.url}/mcp`;
        const clipboardOk = copyToClipboard(connectorUrl);

        writeTunnelUrl(projectDir, connectorUrl);

        if (previousUrl && previousUrl !== connectorUrl && tunnelMode === 'quick') {
          printUrlChanged(previousUrl, connectorUrl, clipboardOk);
        } else if (!previousUrl) {
          printFirstRun(connectorUrl, localUrl, clipboardOk);
        } else {
          printSubsequentRun(connectorUrl, clipboardOk);
        }

        if (tunnelMode === 'named') {
          console.log(`\n  (Permanent tunnel '${config.server.tunnel_name}' — URL never changes)`);
        } else if (previousUrl && previousUrl === `${tunnel.url}/mcp`) {
          // no nudge needed
        } else if (tunnelMode === 'quick' && !previousUrl) {
          // first-run already mentions --stable
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nFailed to start tunnel: ${msg}`);
      console.log(`\nServer is still running locally at ${localUrl}`);
      console.log('Press Ctrl+C to stop.');
    }
  } else {
    const clipboardOk = copyToClipboard(localUrl);
    console.log(`\nCoworker is running (no tunnel).\n`);
    console.log(`  Local URL:  ${localUrl}${clipboardOk ? ' (✓ clipboard)' : ''}\n`);
    console.log('Tunnel disabled. To enable, set server.tunnel_mode: quick in config.yaml');
    console.log('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    shutdownProcesses();
    if (tunnelKill) tunnelKill();
    server.close();
    closeDb();
    deleteTunnelUrl(projectDir);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
