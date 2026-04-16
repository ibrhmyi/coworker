# Coworker

Turn Cowork into an autonomous PM for Claude Code.

Coworker is an open-source local MCP server that lets Anthropic's Cowork
(or any MCP client) delegate coding tasks to Claude Code — with async
parallel execution, auto-verification, session-resuming iteration, and
token-efficient summaries that keep the client's context window small.

## The problem

You use Cowork for thinking and Claude Code for coding. But every task
requires you to copy context from Cowork, paste it into Claude Code,
wait for results, copy the output, paste it back to Cowork, and repeat.
You're a human API. Coworker eliminates the middleman.

## How it works

```
┌────────────┐   MCP/HTTP   ┌──────────────┐   subprocess   ┌──────────────┐
│   Cowork   │─────────────▶│   Coworker   │───────────────▶│ Claude Code  │
│ (PM brain) │              │ (local MCP)  │                │  (engineer)  │
└────────────┘              └──────────────┘                └──────────────┘
      ▲                            │                               │
      │                            ▼                               ▼
      │                     ┌─────────────┐                 ┌────────────┐
      └─────────────────────│  Summaries  │                 │ Your files │
         short summaries    │  + task DB  │                 │ + terminal │
                            └─────────────┘                 └────────────┘
```

1. Cowork calls `submit_task` through the MCP bridge
2. Coworker spawns `claude -p` as a subprocess on your machine
3. Claude Code does the work using your local files and tools
4. Coworker captures the output, runs verification, builds a summary
5. Only the summary returns to Cowork — full output stays on disk
6. For iteration, Cowork calls `iterate_task` — Claude Code resumes
   its session and remembers everything

## Quick start

### One-command setup

```bash
npx coworker-mcp setup
```

This checks dependencies, downloads cloudflared if needed, initializes
the project, and starts the server.

### Manual setup

```bash
npm install -g coworker-mcp
cd your-project
coworker init
coworker start
```

Then add the printed tunnel URL as a custom connector in Claude Desktop:
Settings → Connectors → Add custom connector → paste URL → Save.

### Requirements

- Node.js 20+
- Claude Code CLI (authenticated)
- cloudflared (auto-downloaded by `coworker setup` if missing)

## MCP tools

### submit_task
Submit a coding task to Claude Code. Returns immediately with a task ID.
Claude Code runs asynchronously in the background.

### wait_for_task
Wait for a running task to complete. Returns the full result summary
once done. Use after submit_task for synchronous workflows.

### get_result
Fetch a task's result at different detail levels: oneline, paragraph,
or full (returns file path only — output never enters your context).

### iterate_task
Continue an existing task with feedback. Resumes Claude Code's prior
session via --resume, so it remembers all previous work.

### list_tasks
List recent tasks with compact summaries. Filter by status, time
range, or search prompt text.

### get_project_state
Get the current project state: what's been built, project context,
and decisions. Use at the start of a new conversation to catch up.

## CLI reference

```
coworker setup [dir]         One-command onboarding
coworker init [dir]          Initialize .coworker/ in a project
coworker start [--port N]    Start the MCP server and tunnel
coworker tunnel-setup        Set up a permanent tunnel URL
coworker history [--limit N] List recent tasks
coworker show <task_id>      Show task details and summary
coworker doctor              Run health checks
```

## Configuration

Coworker uses `.coworker/config.yaml` for per-project settings.
All fields are optional with sensible defaults.

```yaml
version: 1

claude:
  binary_path: claude
  default_timeout_seconds: 600
  default_max_turns: 20
  working_directory: .

server:
  port: 0                       # 0 = random free port
  tunnel_mode: quick            # quick | named | none

summary:
  mode: heuristic               # heuristic (free) | llm (~150 tokens/task)

verification:
  enabled: false
  commands: []                  # e.g., ["npm test", "npm run build"]
  max_retries: 2

limits:
  max_concurrent_tasks: 5
  max_task_age_hours: 24
```

## Auto-verification

When configured, Coworker runs your test/build commands after every
task. If they fail, it automatically feeds the error back to Claude
Code and retries — up to `max_retries` times. You get results that
already pass your checks.

```yaml
verification:
  enabled: true
  commands:
    - npm test
    - npm run lint
```

## Project state

Coworker maintains three files automatically:

- `.coworker/STATUS.md` — Updated after every task. What's been built,
  what failed, current state.
- `.coworker/CONTEXT.md` — Project description, tech stack, constraints.
  Edit this to give Claude Code persistent project awareness.
- `.coworker/DECISIONS.md` — Architecture and product decisions log.

These files persist across conversations. Start a new Cowork chat, ask
to read the project state, and you're caught up instantly.

## Stable tunnels

Quick tunnels (default) give a random URL that changes on restart.
For a permanent URL:

```bash
coworker tunnel-setup
```

This creates a named Cloudflare tunnel. Requires a free Cloudflare
account. After setup, your tunnel URL never changes.

## FAQ

**Does this use my Claude subscription credits?**
Yes, the same way typing into Claude Code yourself does. Coworker
invokes `claude -p` as a subprocess — from Anthropic's perspective
it's normal Claude Code usage.

**Is my code sent anywhere?**
Only to Claude Code running locally on your machine. The Cloudflare
tunnel passes MCP protocol messages (task prompts and summaries)
between Cowork's cloud infrastructure and your local server.
Your code files never leave your machine through Coworker.

**Why not just use Claude Code directly?**
For a single quick task, Claude Code directly is fine. Coworker
shines when you're managing a development session: multiple tasks,
iterations, verifications, maintaining project context across
conversations. It lets Cowork be the PM while Claude Code is the
engineer.

**What about --dangerously-skip-permissions?**
Required for headless Claude Code operation. Claude Code runs
without asking for confirmation on file operations. This is the
same tradeoff as any CI/CD pipeline using Claude Code. See the
security section below.

**Will Anthropic ship this natively?**
They're moving in this direction. Coworker is built to be useful
today and compatible with native support when it arrives.

## Security

Coworker runs Claude Code with `--dangerously-skip-permissions`.
This means Claude Code can read, write, and execute files without
confirmation. Recommendations:

- Only run Coworker in project directories you trust
- Use `allowed_tools` in submit_task to restrict capabilities
  for sensitive tasks
- Review `.coworker/results/` for full audit trail of everything
  Claude Code did
- Consider running in a container for additional isolation

## Acknowledgments

Built standing on claude-code-mcp, the broader Claude Code
orchestration community, and the MCP protocol team at Anthropic.

## License

MIT
