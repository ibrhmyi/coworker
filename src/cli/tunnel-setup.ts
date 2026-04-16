import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { findCloudflared, isCloudflaredLoggedIn, getTunnelId } from '../server/tunnel.js';
import { findProjectRoot, getCoworkerDir } from '../utils/paths.js';

export async function tunnelSetup(opts: { name?: string }): Promise<void> {
  const tunnelName = opts.name ?? 'coworker';

  console.log('Coworker Tunnel Setup');
  console.log('━'.repeat(40));
  console.log('This creates a permanent Cloudflare tunnel URL that never changes.\n');

  // 1. Find cloudflared
  let binary: string;
  try {
    binary = findCloudflared();
    console.log(`✓ cloudflared found: ${binary}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${msg}`);
    process.exit(1);
  }

  // 2. Check login
  if (!isCloudflaredLoggedIn()) {
    console.log('\n✗ cloudflared is not logged in.\n');
    console.log('Run this command and follow the browser prompt:');
    console.log(`  ${binary} tunnel login\n`);
    console.log('Then re-run: coworker tunnel-setup');
    process.exit(1);
  }
  console.log('✓ cloudflared is logged in');

  // 3. Check if tunnel already exists
  let tunnelId = getTunnelId(binary, tunnelName);
  if (tunnelId) {
    console.log(`✓ Tunnel '${tunnelName}' already exists (ID: ${tunnelId})`);
  } else {
    // Create tunnel
    console.log(`\nCreating tunnel '${tunnelName}'...`);
    try {
      const output = execSync(`${binary} tunnel create ${tunnelName}`, {
        encoding: 'utf-8',
        timeout: 30_000,
      });
      console.log(output.trim());

      tunnelId = getTunnelId(binary, tunnelName);
      if (!tunnelId) {
        console.error('Tunnel created but ID could not be retrieved. Check `cloudflared tunnel list`.');
        process.exit(1);
      }
      console.log(`✓ Tunnel '${tunnelName}' created (ID: ${tunnelId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ Failed to create tunnel: ${msg}`);
      process.exit(1);
    }
  }

  // 4. Update config.yaml if in a project
  const projectDir = findProjectRoot();
  if (projectDir) {
    const configPath = join(getCoworkerDir(projectDir), 'config.yaml');
    try {
      let content = readFileSync(configPath, 'utf-8');

      // Update tunnel_mode
      if (content.includes('tunnel_mode:')) {
        content = content.replace(/tunnel_mode:\s*\S+/, `tunnel_mode: named`);
      } else {
        content = content.replace(/(enable_tunnel:\s*.+)/, `$1\n  tunnel_mode: named`);
      }

      // Update tunnel_name
      if (content.includes('tunnel_name:')) {
        content = content.replace(/tunnel_name:\s*\S*/, `tunnel_name: ${tunnelName}`);
      } else {
        content = content.replace(/(tunnel_mode:\s*.+)/, `$1\n  tunnel_name: ${tunnelName}`);
      }

      writeFileSync(configPath, content, 'utf-8');
      console.log(`✓ Updated ${configPath}`);
    } catch {
      console.log(`Note: Could not update config.yaml. Manually set tunnel_mode: named and tunnel_name: ${tunnelName}`);
    }
  } else {
    console.log('\nNote: No .coworker/ directory found. Run this from a project directory to auto-update config.');
  }

  // 5. Print success
  const url = `https://${tunnelId}.cfargotunnel.com`;
  console.log(`\n${'━'.repeat(40)}`);
  console.log(`Done! Your permanent tunnel URL is:\n`);
  console.log(`  ${url}/mcp\n`);
  console.log('This URL will be the same every time you run `coworker start`.');
  console.log('Configure it once in Claude Desktop and never change it again.');
}
