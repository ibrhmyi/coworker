import { findProjectRoot } from '../utils/paths.js';
import { loadConfig } from '../core/config.js';
import { startServer, shutdownProcesses } from '../server/mcp.js';
import { startTunnel } from '../server/tunnel.js';
import { closeDb } from '../core/store.js';

export async function start(opts: { port?: string }): Promise<void> {
  const projectDir = findProjectRoot();
  if (!projectDir) {
    console.error('No .coworker/ directory found. Run `coworker init` first.');
    process.exit(1);
  }

  const config = loadConfig(projectDir);
  const port = opts.port ? parseInt(opts.port, 10) : config.server.port;

  const { server, actualPort } = await startServer(port, projectDir);
  console.log(`MCP server listening on http://localhost:${actualPort}/mcp`);

  let tunnelKill: (() => void) | undefined;

  // Determine tunnel mode: respect both enable_tunnel (legacy) and tunnel_mode
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
        const isQuick = tunnelMode === 'quick';

        console.log(`\nCoworker is running.\n`);
        console.log(`  Tunnel URL:  ${tunnel.url}${isQuick ? ' (changes on restart)' : ' (permanent)'}`);
        console.log(`  Local URL:   http://localhost:${actualPort}\n`);
        console.log('To connect from Cowork:');
        console.log('  1. Open Claude Desktop \u2192 Settings \u2192 Connectors');
        console.log('  2. Click "Add custom connector"');
        console.log('  3. Name: Coworker');
        console.log(`  4. URL:  ${tunnel.url}/mcp`);
        console.log('  5. Save, then toggle Coworker on in your conversation\n');
        if (isQuick) {
          console.log("Tip: Run 'coworker tunnel-setup' for a permanent URL that never changes.\n");
        }
        console.log('Press Ctrl+C to stop.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nFailed to start tunnel: ${msg}`);
      console.log(`\nServer is still running locally at http://localhost:${actualPort}/mcp`);
      console.log('Press Ctrl+C to stop.');
    }
  } else {
    console.log(`\nCoworker is running.\n`);
    console.log(`  Local URL:  http://localhost:${actualPort}/mcp\n`);
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
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
