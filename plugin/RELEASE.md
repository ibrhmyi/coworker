# Coworker Plugin v0.1.1 — Release Notes

**Bundle:** `coworker.plugin`
**Target:** Cowork plugin marketplace
**Works with:** `coworker-mcp@0.1.0-alpha.7` (npm) or newer

## What changed from v0.1.0

The MCP transport switched from **HTTP loopback** to **stdio**. Cowork's MCP client
sandbox blocks plain-HTTP loopback URLs, so the v0.1.0 plugin hit "Couldn't reach the
MCP server" when loaded inside Cowork. v0.1.1 uses stdio, which Cowork spawns as a
child process — no sandbox issue, no port bind, no tunnel.

Old `.mcp.json` (v0.1.0):

```json
{ "mcpServers": { "coworker": { "type": "http", "url": "http://127.0.0.1:17429/mcp" } } }
```

New `.mcp.json` (v0.1.1):

```json
{ "mcpServers": { "coworker": { "command": "npx", "args": ["-y", "coworker-mcp@latest", "start", "--stdio"] } } }
```

The stdio process shares `~/.coworker/` state with the long-running HTTP service (DB,
task history, results). `iterate_task` session resumption still works because Claude
Code sessions persist across stdio spawns via the shared DB.

## What shipped

| File | Role |
|------|------|
| `.claude-plugin/plugin.json` | Manifest (name: `coworker`, version: `0.1.1`, MIT, repo link) |
| `.mcp.json` | Declares the `coworker` MCP via `npx coworker-mcp@latest start --stdio` |
| `skills/coworker-pm/SKILL.md` | Teaches the orchestrator how to use the 6 coworker tools (submit/wait/iterate, parallel patterns, what not to do) |
| `skills/coworker-setup/SKILL.md` | Auto-triggers if MCP calls fail — walks the user through `coworker doctor`, `npx coworker-mcp setup`, service repair |
| `README.md` | Install instructions, 6-tool reference, port/security notes, uninstall |
| `LICENSE` | MIT |

## Architecture decision: stdio, not HTTP

Reversing the v0.1.0 call. Cowork's MCP client sandbox does not reach plain-HTTP
loopback URLs (confirmed 2026-04-20: users get "Couldn't reach the MCP server" with
ofid references). Reference plugins in the Cowork ecosystem all use either HTTPS remote
URLs or stdio-spawned commands — none use `type: "http"` with a localhost URL.

Stdio tradeoffs we accept:

1. **Cold start per spawn.** `npx coworker-mcp@latest` incurs a small boot cost when
   Cowork connects the plugin. Subsequent calls on the same connection reuse the
   process.
2. **No background service required for the plugin alone.** The plugin spawns its own
   server. Users who also want `coworker history`/`show` from the terminal can still
   run `coworker start` separately — both paths share `~/.coworker/tasks.json`.

## Requires

- `coworker-mcp@0.1.0-alpha.7` or newer (published to npm 2026-04-20)
- macOS or Linux, Node.js 20+, Claude Code CLI

## Install

In Cowork: Settings → Plugins → Install from file → select `coworker.plugin`. That's
it. No prior `coworker setup`, no URL paste. The first MCP call spawns the server
automatically via `npx`.

## Where the files live

- **Working copy (editable):** `/Users/ibrahimyildiz/Documents/Claude/Projects/COWORKER/plugin/`
- **Packaged bundle:** `/Users/ibrahimyildiz/Documents/Claude/Projects/COWORKER/coworker.plugin`
