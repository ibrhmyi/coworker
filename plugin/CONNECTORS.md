# Connecting Coworker to Cowork

This plugin expects a running Coworker MCP server. Before installing:

1. Run `coworker setup` (or `coworker setup --stable` for a permanent URL) on the machine where your code lives.
2. Note the connector URL printed by `coworker start`.
3. Replace `REPLACE_WITH_YOUR_TUNNEL_URL` in `.mcp.json` with your actual tunnel hostname (e.g. `abc123.cfargotunnel.com` or `random-words.trycloudflare.com`).

For quick tunnels, the URL changes on every `coworker start` — use `coworker setup --stable` once to get a permanent URL.
