import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getGlobalBinDir } from '../utils/paths.js';

/**
 * Find cloudflared binary using lookup chain:
 * 1. System PATH (which cloudflared)
 * 2. Global Coworker bin dir (~/.coworker/bin/cloudflared)
 */
export function findCloudflared(): string {
  // 1. System PATH
  try {
    const resolved = execSync('which cloudflared', { encoding: 'utf-8' }).trim();
    if (resolved) return resolved;
  } catch { /* not in PATH */ }

  // 2. Global Coworker bin
  const globalPath = join(getGlobalBinDir(), 'cloudflared');
  if (existsSync(globalPath)) return globalPath;

  throw new Error(
    'cloudflared not found in PATH or ~/.coworker/bin/. Install it:\n' +
    '  macOS:   brew install cloudflared\n' +
    '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
    '  Or run:  coworker setup (auto-downloads cloudflared)',
  );
}

/** Check if cloudflared tunnel login has been done */
export function isCloudflaredLoggedIn(): boolean {
  const certPath = join(homedir(), '.cloudflared', 'cert.pem');
  return existsSync(certPath);
}

/** Get tunnel ID for a named tunnel */
export function getTunnelId(binary: string, tunnelName: string): string | undefined {
  try {
    const output = execSync(`${binary} tunnel list -o json`, { encoding: 'utf-8', timeout: 10_000 });
    const tunnels = JSON.parse(output);
    if (Array.isArray(tunnels)) {
      const tunnel = tunnels.find((t: { name?: string }) => t.name === tunnelName);
      return tunnel?.id;
    }
  } catch { /* list failed */ }
  return undefined;
}

/** Build the args array for named vs quick tunnel */
export function buildTunnelArgs(mode: 'quick' | 'named', localPort: number, tunnelName?: string): string[] {
  if (mode === 'named' && tunnelName) {
    return ['tunnel', 'run', '--url', `http://localhost:${localPort}`, tunnelName];
  }
  return ['tunnel', '--url', `http://localhost:${localPort}`];
}

function spawnQuickTunnel(binary: string, localPort: number): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(binary, buildTunnelArgs('quick', localPort), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let url = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for Cloudflare tunnel URL (30s). Is cloudflared working?'));
    }, 30_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !url) {
        url = match[0];
        clearTimeout(timeout);
        resolve({ url, child });
      }
    };

    child.stderr.on('data', onData);
    child.stdout.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start cloudflared: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (!url) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before providing a tunnel URL.`));
      }
    });
  });
}

function spawnNamedTunnel(binary: string, localPort: number, tunnelName: string, tunnelId: string): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(binary, buildTunnelArgs('named', localPort, tunnelName), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = `https://${tunnelId}.cfargotunnel.com`;

  return new Promise((resolve, reject) => {
    let connected = false;
    const timeout = setTimeout(() => {
      if (!connected) {
        child.kill('SIGKILL');
        reject(new Error('Timed out waiting for named tunnel to connect (30s).'));
      }
    }, 30_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      // Named tunnels log "Registered tunnel connection" when ready
      if (!connected && (text.includes('Registered tunnel connection') || text.includes('Connection registered'))) {
        connected = true;
        clearTimeout(timeout);
        resolve({ url, child });
      }
    };

    child.stderr.on('data', onData);
    child.stdout.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start cloudflared: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (!connected) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before connecting.`));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TunnelOptions {
  localPort: number;
  mode: 'quick' | 'named' | 'none';
  tunnelName?: string;
}

export async function startTunnel(opts: TunnelOptions): Promise<{ url: string; kill: () => void } | null> {
  if (opts.mode === 'none') return null;

  const binary = findCloudflared();

  if (opts.mode === 'named') {
    if (!opts.tunnelName) {
      throw new Error("tunnel_mode is 'named' but tunnel_name is empty. Run 'coworker tunnel-setup' first.");
    }

    const tunnelId = getTunnelId(binary, opts.tunnelName);
    if (!tunnelId) {
      throw new Error(`Named tunnel '${opts.tunnelName}' not found. Run 'coworker tunnel-setup' to create it.`);
    }

    const { url, child } = await spawnNamedTunnel(binary, opts.localPort, opts.tunnelName, tunnelId);
    let killed = false;

    // Named tunnels keep the same URL on restart, so auto-restart is simpler
    let restartAttempts = 0;
    const MAX_RESTARTS = 3;

    child.on('exit', async (code) => {
      if (killed) return;
      if (restartAttempts >= MAX_RESTARTS) {
        console.error(`Named tunnel crashed (code ${code}). Max restarts reached. MCP server still on localhost.`);
        return;
      }
      restartAttempts++;
      console.error(`Named tunnel crashed (code ${code}). Restarting (${restartAttempts}/${MAX_RESTARTS})...`);
      await sleep(2000);
      try {
        const r = await spawnNamedTunnel(binary, opts.localPort, opts.tunnelName!, tunnelId);
        console.log(`Named tunnel restarted. URL unchanged: ${r.url}/mcp`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Tunnel restart failed: ${msg}. MCP server still on localhost.`);
      }
    });

    return {
      url,
      kill: () => { killed = true; child.kill('SIGTERM'); },
    };
  }

  // Quick tunnel (default)
  let { url, child } = await spawnQuickTunnel(binary, opts.localPort);
  let killed = false;
  let restartAttempts = 0;
  const MAX_RESTARTS = 3;

  child.on('exit', async (code) => {
    if (killed) return;

    if (restartAttempts >= MAX_RESTARTS) {
      console.error(`Cloudflare tunnel crashed (code ${code}). Max restart attempts (${MAX_RESTARTS}) reached. MCP server still available on localhost.`);
      return;
    }

    restartAttempts++;
    console.error(`Cloudflare tunnel crashed (code ${code}). Restarting (attempt ${restartAttempts}/${MAX_RESTARTS})...`);

    await sleep(2000);

    try {
      const result = await spawnQuickTunnel(binary, opts.localPort);
      child = result.child;
      console.log(`Tunnel restarted. New URL: ${result.url}`);
      console.log(`Warning: Tunnel URL changed. Update your connector settings to: ${result.url}/mcp`);

      child.on('exit', async (newCode) => {
        if (killed) return;
        if (restartAttempts >= MAX_RESTARTS) {
          console.error(`Tunnel crashed again (code ${newCode}). Max restarts reached.`);
          return;
        }
        restartAttempts++;
        console.error(`Tunnel crashed (code ${newCode}). Restarting (${restartAttempts}/${MAX_RESTARTS})...`);
        await sleep(2000);
        try {
          const r = await spawnQuickTunnel(binary, opts.localPort);
          child = r.child;
          console.log(`Tunnel restarted. New URL: ${r.url}/mcp`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Tunnel restart failed: ${msg}. MCP server still on localhost.`);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Tunnel restart failed: ${msg}. MCP server still available on localhost.`);
    }
  });

  return {
    url,
    kill: () => {
      killed = true;
      child.kill('SIGTERM');
    },
  };
}
