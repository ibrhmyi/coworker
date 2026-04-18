# Coworker Plugin for Cowork

Turn Cowork into an autonomous PM for Claude Code.

This plugin bundles:
- A remote MCP connector config (`.mcp.json`) pointing at your local Coworker server.
- A `coworker-pm` skill that teaches the model how to use the 6 Coworker tools effectively.

## Install

1. Run `coworker setup --stable` on your dev machine for a permanent tunnel URL (recommended). Or `coworker setup` for a quick tunnel.
2. Update `.mcp.json` — replace `REPLACE_WITH_YOUR_TUNNEL_URL` with the host from your `coworker start` output (e.g. `abc123.cfargotunnel.com`).
3. Install this plugin in Cowork.

## Tools exposed

- `submit_task` — kick off a Claude Code task (async, returns a task_id)
- `wait_for_task` — block until a task finishes
- `iterate_task` — continue a task with feedback (resumes the Claude Code session)
- `get_result` — fetch a task's summary at oneline / paragraph / full levels
- `list_tasks` — list recent tasks
- `get_project_state` — read STATUS.md / CONTEXT.md / DECISIONS.md at conversation start

See the [Coworker repo](https://github.com/coworker/coworker) for the full product docs.

## License

MIT
