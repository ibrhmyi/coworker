import { existsSync, readFileSync } from 'node:fs';
import { findProjectRoot, getTunnelUrlFile } from '../utils/paths.js';
import { loadConfig } from '../core/config.js';
import { findCloudflared, getTunnelId } from '../server/tunnel.js';
import { copyToClipboard } from '../utils/clipboard.js';

export async function url(): Promise<void> {
  const projectDir = findProjectRoot();
  if (!projectDir) {
    console.error('No .coworker/ directory found. Run `coworker init` first.');
    process.exit(1);
  }

  const config = loadConfig(projectDir);

  // Case 1: named tunnel — URL is derived from tunnel ID
  if (config.server.tunnel_mode === 'named' && config.server.tunnel_name) {
    try {
      const binary = findCloudflared();
      const tunnelId = getTunnelId(binary, config.server.tunnel_name);
      if (tunnelId) {
        const url = `https://${tunnelId}.cfargotunnel.com/mcp`;
        const clipboardOk = copyToClipboard(url);
        console.log(url);
        if (clipboardOk) console.log('(✓ copied to clipboard)');
        return;
      }
      console.error(`Named tunnel '${config.server.tunnel_name}' not found. Run: coworker tunnel-setup`);
      process.exit(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Could not resolve named tunnel URL: ${msg}`);
      process.exit(1);
    }
  }

  // Case 2: quick tunnel — read from tunnel-url.txt written by `coworker start`
  const urlFile = getTunnelUrlFile(projectDir);
  if (existsSync(urlFile)) {
    const url = readFileSync(urlFile, 'utf-8').trim();
    if (url) {
      const clipboardOk = copyToClipboard(url);
      console.log(url);
      if (clipboardOk) console.log('(✓ copied to clipboard)');
      return;
    }
  }

  // Case 3: nothing running
  console.error('Server not running. Start with `coworker start`.');
  process.exit(1);
}
