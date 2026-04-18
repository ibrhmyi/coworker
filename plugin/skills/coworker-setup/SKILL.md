---
name: coworker-setup
description: >
  Use this skill when the Coworker MCP tools (submit_task, wait_for_task, etc.) aren't
  available or return connection errors. Trigger phrases: "coworker isn't connected",
  "the coworker tools aren't showing up", "set up coworker", "install coworker",
  "coworker doctor", "why can't I use coworker", or any time a Coworker MCP call
  errors with ECONNREFUSED, 404, or "connection failed".
metadata:
  version: "0.1.0"
---

# Coworker Setup Skill

Walk the user through getting the Coworker background service running so the plugin's
MCP connection (http://127.0.0.1:17429/mcp) resolves.

## Preflight: confirm what's wrong

Ask the user to run:

```
coworker doctor
```

The output tells you exactly what's missing. Expected green checks:

- `✓ node installed`
- `✓ claude code installed`
- `✓ coworker-mcp installed`
- `✓ background service: installed and running`

If `coworker` isn't a recognized command, skip to "First-time install" below.

## First-time install

The plugin requires one command to bootstrap the local side:

```
npx coworker-mcp@latest setup
```

This installs the background service (launchd on macOS, systemd on Linux), starts it on
port 17429, and registers it to auto-start on login. After that, the user can close the
terminal — the service keeps running.

After setup, confirm the MCP endpoint is live:

```
curl -sS http://127.0.0.1:17429/health
```

Should return a 200 with a JSON body. If the response is green, the plugin's MCP
connection will pick it up on the next Cowork restart.

## If the service is installed but not running

```
coworker restart-service
coworker doctor
```

If `restart-service` fails, inspect the logs:

- macOS: `~/Library/Logs/coworker.log` and the plist at `~/Library/LaunchAgents/com.coworker.mcp.plist`
- Linux: `journalctl --user -u coworker`

Common issues:

- **Port 17429 in use.** Another service is bound to the port. Either kill the other
  process or reinstall with a custom port via `coworker install-service --port 18000`.
- **Stale install path.** If the user upgraded Node or reinstalled coworker-mcp via a
  different package manager (pnpm vs npm global), run
  `coworker uninstall-service && coworker install-service` to regenerate the service
  definition against the current binary location.

## If MCP calls still fail after the service is up

Restart Cowork so it re-reads the plugin's `.mcp.json`. Plugin MCP connections are
resolved at startup — a service that comes online after Cowork starts won't be picked
up until Cowork restarts.

## What you don't need

- **No Cloudflare tunnel.** The plugin talks to localhost directly. `coworker setup`
  used to require a tunnel for remote Cowork; inside the plugin, that's bypassed.
- **No manual URL paste.** The `.mcp.json` in the plugin hardcodes 127.0.0.1:17429.
- **No API key.** The local server is unauthenticated because it only binds to
  loopback. Don't expose port 17429 on the network.

## Uninstall

```
coworker uninstall-service
npm uninstall -g coworker-mcp   # or pnpm remove -g coworker-mcp
```

Then remove the plugin from Cowork via Settings → Plugins.
