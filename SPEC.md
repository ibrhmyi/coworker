# Coworker — Build Spec v0.1

## What we're building

Coworker is an open-source local MCP server that exposes task-oriented tools to any MCP client (primarily Anthropic's Cowork, but also Cursor, Windsurf, custom workflows). Those tools let the client delegate coding work to the user's locally-installed Claude Code CLI, running as a subprocess with its own context window. Results come back as structured summaries, not full transcripts, keeping the client's context window small.

Target user: a solo developer or technical founder who uses both Cowork and Claude Code and is tired of being the copy-paste messenger between them. The tool should install in under 5 minutes, work on the user's existing Claude subscription with no API keys, and let Cowork run autonomous PM loops against Claude Code without exhausting context.

## Core design principles (do not violate)

1. **Nothing heavy ever enters the client's context.** Full Claude Code outputs live in files. The client only sees tiny summaries via tool return values. This is the whole point of the product — every design decision defers to it.
2. **Use the user's Claude subscription normally.** Coworker invokes `claude -p` as a subprocess. No API keys, no separate auth, no billing changes. From Anthropic's perspective it looks like any other interactive Claude Code usage.
3. **Session resumption over re-invocation.** When an iteration is needed, Coworker uses `claude -p --resume <session-id>` so Claude Code remembers its prior work. Coworker tracks session IDs per task.
4. **Files are truth, memory is cache.** All task state, all outputs, all summaries, all logs live in files. Coworker's own memory is just a convenience layer. Restart the process and nothing is lost.
5. **Fail loud, not silent.** Every failure mode returns a clear error to the MCP client. No silent timeouts, no "it just didn't work." The client should always know what happened.

## Architecture overview

```
MCP Client (Cowork, Cursor, etc.)
          │
          │ MCP over HTTPS (tunneled)
          ▼
┌──────────────────────────────────┐
│  Coworker MCP Server             │
│  (Node.js + TypeScript)          │
│                                  │
│  ├── MCP tool handlers           │
│  ├── Task dispatcher             │
│  ├── Subprocess manager          │
│  ├── SQLite task store           │
│  ├── Summary builder             │
│  └── CLI                         │
└──────────┬───────────────────────┘
           │ spawns subprocess
           ▼
┌──────────────────────────────────┐
│  claude -p (Claude Code CLI)     │
│  (user's local install)          │
└──────────┬───────────────────────┘
           │ reads/writes
           ▼
┌──────────────────────────────────┐
│  User's project filesystem       │
└──────────────────────────────────┘
```

The Coworker process runs locally on the user's machine. On startup, it also launches a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:PORT`) to expose itself publicly with a temporary HTTPS URL. The user pastes that URL into Cowork's custom connector settings. Cowork then talks to Coworker over HTTPS through Anthropic's cloud infrastructure, which is the only officially supported Cowork MCP path.

## Tech stack

- **Language:** TypeScript (Node.js 20+)
- **MCP SDK:** `@modelcontextprotocol/sdk` (official TypeScript SDK)
- **Transport:** HTTP streamable (not stdio, because Cowork doesn't support stdio)
- **Database:** `better-sqlite3` (synchronous, fast, zero-config)
- **CLI framework:** `commander` (mature, simple)
- **Process management:** Node's built-in `child_process.spawn`
- **Tunnel:** `cloudflared` binary, spawned as subprocess. Download instructions in README. If not installed, Coworker prints a clear error with install link.
- **Schema validation:** `zod` (pairs well with the MCP SDK)
- **Logging:** `pino` (structured JSON logs to `.coworker/logs/`)
- **Testing:** `vitest`
- **Build:** `tsup` for bundling, produces a single executable JS file
- **Package manager:** `pnpm` (faster than npm for dev)
- **Target install:** `npm install -g coworker` (published to npm)

## Directory structure (the product itself)

```
coworker/
├── src/
│   ├── index.ts              # Entry point, CLI dispatcher
│   ├── cli/
│   │   ├── init.ts           # coworker init
│   │   ├── start.ts          # coworker start
│   │   ├── stop.ts           # coworker stop
│   │   ├── history.ts        # coworker history
│   │   ├── show.ts           # coworker show <task_id>
│   │   └── doctor.ts         # coworker doctor
│   ├── server/
│   │   ├── mcp.ts            # MCP server setup
│   │   ├── tools/
│   │   │   ├── submit.ts     # submit_task tool handler
│   │   │   ├── get.ts        # get_result tool handler
│   │   │   ├── iterate.ts    # iterate_task tool handler
│   │   │   └── list.ts       # list_tasks tool handler
│   │   └── tunnel.ts         # Cloudflare tunnel lifecycle
│   ├── core/
│   │   ├── dispatcher.ts     # Queues and routes tasks
│   │   ├── subprocess.ts     # Spawns and manages claude -p
│   │   ├── summary.ts        # Builds one-line and paragraph summaries
│   │   ├── store.ts          # SQLite task store
│   │   └── config.ts         # Loads .coworker/config.yaml
│   ├── types/
│   │   └── task.ts           # TypeScript types shared across modules
│   └── utils/
│       ├── paths.ts          # Resolves .coworker/ folder locations
│       └── logger.ts         # Pino setup
├── test/
│   ├── unit/
│   └── integration/
├── bin/
│   └── coworker              # Shebang-wrapped entry
├── README.md
├── LICENSE                   # MIT
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── .github/
    └── workflows/
        └── ci.yml            # Lint, test, build on push
```

## Directory structure (what Coworker creates in user projects)

When a user runs `coworker init` in their project, Coworker creates:

```
<user_project>/
└── .coworker/
    ├── config.yaml           # Project config (model, timeouts, limits)
    ├── tasks.db              # SQLite database
    ├── logs/
    │   └── coworker.log      # Append-only log
    └── results/
        └── <task_id>/
            ├── prompt.md     # The prompt sent to Claude Code
            ├── output.md     # Full Claude Code output
            └── summary.md    # Paragraph summary
```

The `.coworker/` folder is per-project and should be gitignored by default (Coworker creates `.coworker/.gitignore` with `*` on init).

## MCP tool definitions

Four tools exposed via MCP. These are the entire public API of Coworker.

### Tool 1: `submit_task`

**Description:** Submit a new coding task to Claude Code. Runs as a subprocess in the user's configured working directory. Returns a task ID and a short summary of the result.

**Input schema:**
```typescript
{
  prompt: string;              // The task description sent to Claude Code
  working_directory?: string;  // Optional: override config default
  allowed_tools?: string[];    // Optional: restrict Claude Code's tools for this task
  max_turns?: number;          // Optional: cap iterations, default from config
  timeout_seconds?: number;    // Optional: kill after N seconds, default 600
}
```

**Behavior:**
1. Generate a task ID (format: `task_YYYYMMDD_HHMMSS_<6char>`, e.g., `task_20260414_153022_a7f3b9`).
2. Create the task row in SQLite with status `running`.
3. Spawn a subprocess: `claude -p "<prompt>" --output-format json --dangerously-skip-permissions` with any optional flags set. Capture the subprocess's Claude Code session ID from the first JSON line.
4. Capture full stdout and stderr to `.coworker/results/<task_id>/output.md`.
5. Enforce the timeout. If exceeded, kill the subprocess and mark the task `failed` with reason `timeout`.
6. When the subprocess exits, parse the JSON output to extract success/failure and any model-reported summary. Update the task row with session ID, status (`done` or `failed`), end timestamp.
7. Generate a paragraph summary using the summary builder.
8. Return to the client:

```typescript
{
  task_id: string;
  status: "done" | "failed";
  summary: string;             // ~2-4 sentence paragraph
  result_path: string;         // absolute path to output.md for optional reading
  duration_seconds: number;
  claude_session_id: string;   // so the client can reference it
}
```

The returned summary should be the paragraph level by default. The full output is NEVER included in the return value — it lives only on disk. This is the core token-efficiency guarantee.

### Tool 2: `get_result`

**Description:** Fetch a summary of a completed task at a specified detail level. Full output is never returned inline; only the path.

**Input schema:**
```typescript
{
  task_id: string;
  level: "oneline" | "paragraph" | "full";   // default "paragraph"
}
```

**Behavior:**
1. Look up the task in SQLite.
2. If not found, return an error.
3. Based on level:
   - `oneline`: return the first line of the summary (one sentence of success/failure).
   - `paragraph`: return the full paragraph summary from `summary.md`.
   - `full`: return ONLY the absolute file path to `output.md`, plus the paragraph summary. Do NOT inline the full output. If the client wants to read the full output, it can do so via its own filesystem access. This prevents even a "give me everything" call from exploding the client's context.

**Return:**
```typescript
{
  task_id: string;
  status: "done" | "failed" | "running";
  level: "oneline" | "paragraph" | "full";
  content: string;           // the actual summary at the requested level
  result_path?: string;      // included when level === "full"
}
```

### Tool 3: `iterate_task`

**Description:** Continue an existing task with feedback. Claude Code's prior session is resumed via `--resume`, so it remembers what it did and only needs the delta.

**Input schema:**
```typescript
{
  task_id: string;             // existing task
  feedback: string;            // the follow-up prompt
  timeout_seconds?: number;
}
```

**Behavior:**
1. Look up the original task. Must have status `done` or `failed` (not `running`). Must have a `claude_session_id`.
2. Generate a new task ID for the iteration. Tie it to the original via a `parent_task_id` field.
3. Spawn: `claude -p "<feedback>" --resume <claude_session_id> --output-format json --dangerously-skip-permissions`.
4. Same capture, same timeout, same summary generation as `submit_task`.
5. Return the same shape as `submit_task`, plus `parent_task_id: string` so the client knows the lineage.

This is the feature that makes iteration cheap. The client doesn't re-pass any context — Claude Code remembers its own session. Coworker just tells it what to change.

### Tool 4: `list_tasks`

**Description:** List recent tasks, optionally filtered. Use this to let the PM (Cowork) see what's been run without scanning its own history.

**Input schema:**
```typescript
{
  status?: "running" | "done" | "failed" | "all";  // default "all"
  limit?: number;              // default 20, max 100
  since_hours?: number;        // only tasks created in the last N hours
  search?: string;             // substring match on prompt
}
```

**Behavior:**
1. Query SQLite with the filters.
2. Return a compact list — NO full prompts, NO full outputs, just identifiers and one-liners.

**Return:**
```typescript
{
  tasks: Array<{
    task_id: string;
    status: "running" | "done" | "failed";
    created_at: string;              // ISO
    duration_seconds: number;
    prompt_preview: string;          // first 80 chars of prompt
    oneline_summary: string;         // 1-sentence result summary
    parent_task_id?: string;         // if it's an iteration
  }>;
  total_count: number;               // how many matched the filter total
  returned_count: number;
}
```

## SQLite schema

One table for v0.1. Keep it flat and simple.

```sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  status TEXT NOT NULL,              -- 'running' | 'done' | 'failed'
  created_at TEXT NOT NULL,          -- ISO timestamp
  completed_at TEXT,                 -- ISO timestamp, null if running
  duration_seconds REAL,

  prompt TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  allowed_tools TEXT,                -- JSON array as string
  max_turns INTEGER,
  timeout_seconds INTEGER NOT NULL,

  claude_session_id TEXT,
  exit_code INTEGER,
  failure_reason TEXT,               -- 'timeout', 'nonzero_exit', 'parse_error', etc.

  oneline_summary TEXT,
  paragraph_summary TEXT,

  output_path TEXT NOT NULL,
  prompt_path TEXT NOT NULL,

  FOREIGN KEY (parent_task_id) REFERENCES tasks(task_id)
);

CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
```

## Subprocess manager logic

Pseudocode for the core function that spawns Claude Code. This is the hottest part of the codebase and has to handle a lot of edge cases.

```typescript
async function runClaudeCode(opts: {
  prompt: string;
  workingDir: string;
  resumeSessionId?: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds: number;
  outputPath: string;
}): Promise<{
  sessionId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const args = ['-p', opts.prompt, '--output-format', 'json', '--dangerously-skip-permissions'];

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }
  if (opts.allowedTools) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  if (opts.maxTurns !== undefined) {
    args.push('--max-turns', String(opts.maxTurns));
  }

  const child = spawn('claude', args, {
    cwd: opts.workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let sessionId = '';

  const outStream = createWriteStream(opts.outputPath, { flags: 'w' });

  child.stdout.on('data', (chunk) => {
    const str = chunk.toString();
    stdout += str;
    outStream.write(str);

    if (!sessionId) {
      for (const line of str.split('\n')) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.session_id) {
            sessionId = json.session_id;
            break;
          }
        } catch {
          // not a complete JSON line yet, ignore
        }
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, opts.timeoutSeconds * 1000);

  const exitCode: number = await new Promise((resolve) => {
    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      outStream.end();
      resolve(code ?? -1);
    });
  });

  return { sessionId, exitCode, stdout, stderr, timedOut };
}
```

Key gotchas to handle carefully:
- **`claude` binary not found** — before spawning, check `which claude`. If missing, throw a clear error telling the user to install Claude Code.
- **Session ID not appearing in output** — some Claude Code versions may not emit session_id on the first line. Add a fallback: scan the whole stdout after exit, and if no session ID found, check `~/.claude/projects/` for the most recently modified file that matches the current working directory. Log a warning and continue.
- **Orphaned processes on Coworker crash** — on startup, Coworker should scan SQLite for tasks stuck in `running` status with created_at > 1 hour ago and mark them `failed` with reason `orphaned`.
- **Multiple concurrent tasks** — SQLite is fine for this, but make sure the subprocess manager doesn't block. Each task runs in its own subprocess concurrently.

## Summary builder logic

After a task completes, Coworker needs to produce two summary levels: `oneline` and `paragraph`.

**For v0.1, implement Approach A (heuristic extraction).** Parse the JSON output for Claude Code's final assistant message. Extract the first sentence for `oneline`, the first 3-5 sentences for `paragraph`. Fast, deterministic, no extra tokens.

Heuristic implementation:
```typescript
function buildSummary(fullOutput: string): { oneline: string; paragraph: string } {
  const lines = fullOutput.split('\n').filter(l => l.trim());
  const messages = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const finalAssistant = [...messages].reverse().find(m => m.type === 'assistant' && m.text);
  const text = finalAssistant?.text ?? 'Task completed with no final message.';

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const oneline = sentences[0]?.trim().slice(0, 200) ?? 'Task completed.';
  const paragraph = sentences.slice(0, 4).join(' ').trim().slice(0, 800);

  return { oneline, paragraph };
}
```

Write both summaries to `summary.md` and to the SQLite row.

## Cloudflare tunnel lifecycle

On `coworker start`:
1. Check for `cloudflared` binary. If missing, print install instructions and exit with error.
2. Start the MCP HTTP server on a random available port (e.g., 17429).
3. Spawn `cloudflared tunnel --url http://localhost:<port>` as a child process.
4. Parse cloudflared's stderr to extract the assigned `*.trycloudflare.com` URL.
5. Print connection instructions to the user.
6. On Ctrl+C, gracefully shut down the MCP server, kill cloudflared, then exit.

## CLI commands

```bash
coworker init [directory]
coworker start [--port N]
coworker stop
coworker history [--limit N] [--status S]
coworker show <task_id> [--level L]
coworker doctor
```

## Config file format

`.coworker/config.yaml` (YAML for human readability):

```yaml
version: 1
claude:
  binary_path: claude
  default_timeout_seconds: 600
  default_max_turns: 20
  default_allowed_tools: []
  working_directory: .
server:
  port: 0
  enable_tunnel: true
summary:
  mode: heuristic
  oneline_max_chars: 200
  paragraph_max_chars: 800
limits:
  max_concurrent_tasks: 5
  max_task_age_hours: 24
```

## Things explicitly out of scope for v0.1

- Multi-user support
- Hosted service
- Web dashboard
- Authentication / OAuth
- Desktop Extension (.mcpb) packaging
- Team-shared config or shared task stores
- Secondary-LLM summary mode
- Any integration with Cursor, Windsurf, or other clients beyond "it's MCP, it probably works."
- Prompt templates or skills bundled with Coworker
- Analytics, telemetry, metrics
