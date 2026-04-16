# Friction Log

Every handoff pain during the Coworker build. Each entry is a future feature spec.

---

- **2026-04-14**: Cloudflare quick tunnel URL is random and changes every restart. Had to manually copy-paste it. This is the exact kind of handoff Coworker needs to automate — the tunnel URL should be auto-registered or at least copied to clipboard.
- **2026-04-14**: MCP SDK returns SSE-formatted responses (`event: message\ndata: ...`) even when `Accept: application/json` is sent. Need to verify Cowork handles SSE transport correctly through the tunnel. Stateless mode works fine for the spike.
- **2026-04-14**: `better-sqlite3` and `esbuild` need native build approval (`pnpm.onlyBuiltDependencies`) — the interactive `pnpm approve-builds` prompt doesn't work in non-interactive shells. Had to set it in package.json directly.
- **2026-04-14**: Sentence splitting in summaries is non-trivial — naive regex `[^.!?]+[.!?]+` breaks on filenames like `auth.ts`. Switched to splitting on `. ` (dot-space) which works for code-related text.
- **2026-04-14**: The MCP SDK's `StreamableHTTPServerTransport` in stateless mode requires creating a new McpServer instance per request. Not a problem for performance but worth noting — the server is truly stateless from the MCP protocol perspective, all state lives in SQLite.
- **2026-04-14**: Session resumption with `--resume` on iterate_task works perfectly — Claude Code picks up exactly where it left off. The fallback-to-fresh-session logic is in place but hasn't been triggered yet in testing.
- **2026-04-14**: Zod v4's `.optional().default()` on nested objects doesn't propagate defaults to inner fields when the outer default is `{}`. Had to use explicit `DEFAULTS` object + deep merge instead of relying on zod's defaults alone. This is a footgun.
- **2026-04-14**: The default CONTEXT.md template exceeds the 200-char threshold for "real content", so `readContextFile` treats it as real context and prepends it to every prompt. This is actually fine — the template serves as a useful prompt even before the user customizes it. But worth noting if the threshold changes.
- **2026-04-14**: Auto-verification loop is clean in theory but hard to unit test — it depends on `execSync` + `runClaudeCode` in a tight retry loop inside `submitTask`. Tested config layer and command execution separately. Integration testing with a real project will be the real validation.
- **2026-04-16**: `coworker` is taken on npm (v0.0.2, 'web-worker' wrapper, published over a year ago). Using `coworker-cli` as the package name. Binary name stays `coworker`. `npx coworker-cli setup` is the golden path.
- **2026-04-16**: cloudflared auto-download on macOS uses a tgz tarball (not a direct binary) — need to `curl | tar xz` instead of just `curl -o`. The macOS arm64 and x64 both use the amd64 build (Rosetta 2 handles arm64 transparently for cloudflared).
- **2026-04-16**: Removed `coworker stop` entirely. PID file tracking was confusing when the server runs in the foreground. Ctrl+C with SIGINT/SIGTERM handlers is cleaner and eliminates a class of stale-PID bugs.
- **2026-04-16**: Making submit_task async required splitting `runClaudeCode` into `spawnClaudeCode` (returns child + promise) and `runClaudeCode` (convenience wrapper). The background completion handler runs in a `.then()` — unhandled rejections would silently fail, so all errors must be caught and persisted to the DB.
- **2026-04-16**: `better-sqlite3` is synchronous and single-connection, so concurrent background task completions writing to SQLite serialize naturally — no mutex needed. This is a feature, not a limitation, for this use case.
- **2026-04-16**: The `wait_for_task` polling interval (2s) is a tradeoff — shorter means faster response but more DB reads, longer means sluggish UX. 2s feels right for coding tasks that take 30s-10min. The polling test adds ~3s to the test suite.
- **2026-04-16**: Named tunnels require a Cloudflare account and `cloudflared tunnel login` — can't be fully automated. Kept it as a guided `coworker tunnel-setup` command. Quick tunnels remain the zero-config default.
- **2026-04-16**: Detecting a named tunnel connection is trickier than quick tunnels. Quick tunnels print the URL to stderr. Named tunnels print "Registered tunnel connection" but the URL is derived from the tunnel ID (`<id>.cfargotunnel.com`), not logged. Had to look up the tunnel ID from `cloudflared tunnel list -o json` first.
- **2026-04-16**: LLM summary mode spawns a second `claude -p` call after each task. 30s timeout, 1 max turn, last 4000 chars of output. Falls back to heuristic on any failure. This doubles the API calls but the summary call is very cheap (~100 tokens prompt, ~50 tokens response).
- **2026-04-16**: The `enable_tunnel` boolean config and the new `tunnel_mode` enum need to coexist. `enable_tunnel: false` overrides `tunnel_mode` to `'none'`. This avoids breaking existing configs.
