# Coworker Plugin for Cowork

**Turn Cowork into an autonomous PM for Claude Code.**

This plugin connects Cowork to [Coworker](https://github.com/ibrhmyi/coworker), a local
MCP server that delegates coding tasks to the Claude Code CLI on your machine. The
orchestrator (Cowork) plans; the worker (Claude Code) executes. You get 93–98% less
token use in the orchestrator context vs. doing everything in one conversation.

## What you get

Six MCP tools, exposed to Cowork over localhost (no tunnel, no manual URL paste):

| Tool | What it does |
|------|--------------|
| `submit_task` | Kick off a Claude Code task async; returns a `task_id`. |
| `wait_for_task` | Block until a task finishes. |
| `iterate_task` | Continue a task with feedback — Claude Code resumes the prior session. |
| `get_result` | Fetch a task summary at oneline / paragraph / full levels. |
| `list_tasks` | List recent tasks, filter by status or search. |
| `get_project_state` | Read STATUS.md / CONTEXT.md / DECISIONS.md at conversation start. |

Plus two bundled skills:

- **`coworker-pm`** — teaches the orchestrator when and how to delegate through the six
  tools, how to parallelize, when to iterate vs. submit fresh, and what to avoid.
- **`coworker-setup`** — triggers automatically if the MCP connection fails, walking
  the user through `coworker doctor` and one-command install/repair.

## Install

### 1. Install the Coworker server (one command)

On your dev machine, run:

```
npx coworker-mcp@latest setup
```

This installs `coworker-mcp`, registers a background service (launchd on macOS,
systemd on Linux), and starts it on `127.0.0.1:17429`. You can close the terminal —
the service keeps running and auto-starts on login.

Verify with:

```
coworker doctor
```

Expected: all green checks, including `✓ background service: installed and running`.

### 2. Install this plugin

In Cowork: **Settings → Plugins → Install from file**, select `coworker.plugin`.

Or if you've published to a marketplace:

```
/plugins install coworker
```

Cowork will pick up the MCP connection to `http://127.0.0.1:17429/mcp` on its next
restart.

### 3. Verify end-to-end

In a new Cowork conversation:

> Use the coworker tools to read package.json in ~/Documents/Claude/Projects/coworker-source
> and tell me the version field.

If the tools are wired up correctly, Cowork will call `submit_task`, wait, and report
the version. If anything errors, the `coworker-setup` skill kicks in automatically to
guide you through repair.

## Why this exists

Before Coworker, delegating to Claude Code meant copying your task into a terminal,
waiting, then copying the result back. This plugin closes that loop: Cowork becomes
the planner, Claude Code becomes the worker, and your context window stays clean.

Token savings come from never putting raw code into the orchestrator — only summaries
and decisions. In practice that's the difference between running out of context at
turn 12 and running out at turn 120.

## Requirements

- macOS or Linux (Windows support pending — service install uses launchd/systemd).
- Node.js 20 or newer.
- Claude Code CLI installed (`npm i -g @anthropic-ai/claude-code` or equivalent).

## Port and security

The MCP server binds to **loopback only** (`127.0.0.1:17429`). It is unauthenticated by
design because nothing outside your machine can reach it. Don't forward the port.

## Troubleshooting

The plugin bundles a `coworker-setup` skill that fires whenever MCP calls fail. Most
issues are resolved by:

```
coworker doctor            # diagnose
coworker restart-service   # kick the background service
```

If the plugin tools aren't showing up in Cowork even after `doctor` is all green,
restart Cowork — MCP connections are resolved at startup.

## Uninstall

```
coworker uninstall-service
npm uninstall -g coworker-mcp
```

Then remove the plugin from Cowork via **Settings → Plugins**.

## License

MIT. See `LICENSE`.

## Links

- Coworker source: https://github.com/ibrhmyi/coworker
- npm package: [`coworker-mcp`](https://www.npmjs.com/package/coworker-mcp)
- Issues: https://github.com/ibrhmyi/coworker/issues
