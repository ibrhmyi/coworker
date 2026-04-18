<p align="center">
  <h1 align="center">Coworker</h1>
  <p align="center">
    <strong>Turn Cowork into an autonomous PM for Claude Code.</strong>
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> &middot;
    <a href="#how-it-works">How It Works</a> &middot;
    <a href="#mcp-tools">MCP Tools</a> &middot;
    <a href="#configuration">Configuration</a> &middot;
    <a href="#faq">FAQ</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/npm/v/coworker-mcp?color=blue&label=npm" alt="npm version" />
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node 20+" />
    <img src="https://img.shields.io/badge/tools-6%20MCP%20tools-purple" alt="6 MCP tools" />
    <img src="https://img.shields.io/badge/tests-84%20passing-brightgreen" alt="84 tests" />
  </p>
</p>

---

Coworker is an open-source local MCP server that lets Anthropic's Cowork (or any MCP client) delegate coding tasks to Claude Code — with async parallel execution, auto-verification, session-resuming iteration, and token-efficient summaries that keep the client's context window small.

**93-98% fewer tokens** in the orchestrator's context. **Zero copy-paste.** **Parallel task execution.** Your AI PM thinks while your AI engineer codes.

## The Problem

You use Cowork for thinking and Claude Code for coding. But every task requires you to:

1. Copy context from Cowork
2. Paste it into Claude Code
3. Wait for results
4. Copy the output
5. Paste it back to Cowork
6. Repeat 10-15 times per feature

You're a human API between two AI tools. Coworker eliminates the middleman.

## How It Works

```
You ── natural language ──► Cowork (PM)
                               │
                               │ MCP tools (submit, iterate, verify)
                               ▼
                          Coworker (bridge)
                               │
                               │ spawns subprocess
                               ▼
                          Claude Code (engineer)
                               │
                               │ reads/writes
                               ▼
                          Your project files
```

1. **You** describe what you want to Cowork
2. **Cowork** calls `submit_task` through the MCP bridge
3. **Coworker** spawns `claude -p` as a subprocess on your machine
4. **Claude Code** does the work using your local files and tools
5. **Coworker** captures the output, runs verification, builds a summary
6. **Only the summary** returns to Cowork — full output stays on disk
7. For iteration, Cowork calls `iterate_task` — Claude Code **resumes its session** and remembers everything

## Real Numbers

Measured from a 5-task development session with iterations:

| Metric | Without Coworker | With Coworker |
|--------|-----------------|---------------|
| Tokens in PM context | ~15,000-55,000 | ~1,100 |
| User actions per task | 4 (copy, switch, paste, switch) | 0 |
| Parallel tasks | Impossible | Yes |
| Claude Code cost | $0.62 | $0.62 (identical) |
| Context runway | ~5-8 tasks before degradation | 50+ tasks |

Coworker doesn't save money on the coding side — it saves **your time** and **your PM's context space**.

## Quick Start

### One-command setup

```bash
npx coworker-mcp setup
```

This checks dependencies, downloads cloudflared if needed, initializes the project, and starts the server. The connector URL is **automatically copied to your clipboard**.

### Then connect to Cowork

1. Open Claude Desktop → Settings → Connectors
2. Add custom connector → **Paste** (URL is on your clipboard)
3. Save → Toggle on in your conversation
4. Say: *"What tools do you have?"* — you should see 6 Coworker tools

### For a permanent URL (recommended)

```bash
npx coworker-mcp setup --stable
```

Sets up a named Cloudflare tunnel. URL never changes. Paste once, done forever.

### Requirements

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (authenticated)
- cloudflared (auto-downloaded if missing)

## MCP Tools

### `submit_task`
Submit a coding task to Claude Code. **Returns immediately** — Claude Code runs asynchronously in the background.

### `wait_for_task`
Wait for a running task to complete. Returns the summary once done. Enables the **submit → do other things → check result** pattern.

### `get_result`
Fetch a task's result at three detail levels: `oneline`, `paragraph`, or `full` (returns file path only — output **never** enters the client's context).

### `iterate_task`
Continue a task with feedback. Resumes Claude Code's prior session via `--resume` — it **remembers all previous work**. No context re-sent.

### `list_tasks`
List recent tasks with compact summaries. Filter by status, time range, or search prompt text.

### `get_project_state`
Get the current project state: what's been built, project context, and decisions. **Start any new conversation with this** to catch up instantly.

## Auto-Verification

Coworker can run your tests and build commands after every task. If they fail, it **automatically feeds the error back** to Claude Code and retries.

```yaml
# .coworker/config.yaml
verification:
  enabled: true
  commands:
    - npm test
    - npm run lint
  max_retries: 2
```

You get results that already pass your checks.

## Project State

Coworker maintains three files automatically — you never edit these:

| File | Purpose | Updated |
|------|---------|---------|
| `STATUS.md` | What's been built, what failed | After every task |
| `CONTEXT.md` | Project description, tech stack | By you or Cowork |
| `DECISIONS.md` | Architecture decisions log | During conversations |

Start a new Cowork conversation → ask to read the project state → **fully caught up in one message**.

## CLI Reference

```
coworker setup [--stable]    One-command onboarding (--stable for permanent URL)
coworker init [dir]          Initialize .coworker/ in a project
coworker start [--port N]    Start the MCP server and tunnel
coworker url                 Print connector URL (auto-copies to clipboard)
coworker tunnel-setup        Set up a permanent tunnel URL
coworker history [--limit N] List recent tasks
coworker show <task_id>      Show task details and summary
coworker doctor              Run health checks (9 checks)
```

## Configuration

All fields optional. Sensible defaults for everything.

```yaml
# .coworker/config.yaml
version: 1

claude:
  binary_path: claude
  default_timeout_seconds: 600
  default_max_turns: 20
  working_directory: .

server:
  port: 17429
  tunnel_mode: quick            # quick | named | none

summary:
  mode: heuristic               # heuristic (free) | llm (~150 tokens/task)

verification:
  enabled: false
  commands: []
  max_retries: 2

limits:
  max_concurrent_tasks: 5
  max_task_age_hours: 24
```

## FAQ

<details>
<summary><strong>Does this use my Claude subscription credits?</strong></summary>
Yes, the same way typing into Claude Code yourself does. Coworker invokes <code>claude -p</code> as a subprocess — from Anthropic's perspective it's normal Claude Code usage.
</details>

<details>
<summary><strong>Is my code sent anywhere?</strong></summary>
Only to Claude Code running locally on your machine. The Cloudflare tunnel passes MCP protocol messages (task prompts and summaries) between Cowork's cloud infrastructure and your local server. Your code files never leave your machine through Coworker.
</details>

<details>
<summary><strong>Why not just use Claude Code directly?</strong></summary>
For a single quick task, Claude Code directly is fine. Coworker shines when you're managing a development session: multiple tasks, iterations, verifications, maintaining project context across conversations. It lets Cowork be the PM while Claude Code is the engineer.
</details>

<details>
<summary><strong>What about --dangerously-skip-permissions?</strong></summary>
Required for headless Claude Code operation. Claude Code runs without asking for confirmation on file operations. This is the same tradeoff as any CI/CD pipeline using Claude Code.
</details>

<details>
<summary><strong>Will Anthropic ship this natively?</strong></summary>
They're moving in this direction. Coworker is built to be useful today and compatible with native support when it arrives.
</details>

## Security

Coworker runs Claude Code with `--dangerously-skip-permissions`. Recommendations:

- Only run in project directories you trust
- Use `allowed_tools` in submit_task to restrict capabilities
- Review `.coworker/results/` for full audit trail
- Consider running in a container for isolation

## Built With

- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Protocol layer
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Task store
- [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — HTTPS bridge
- TypeScript, Node.js 20+, 84 tests, 82KB bundle

## License

MIT

---

<p align="center">
  <sub>Built by shipping the tool that eliminates the workflow used to build it.</sub>
</p>
