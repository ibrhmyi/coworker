---
name: coworker-pm
description: >
  Use when the user asks for coding work, bug fixes, feature implementation, refactoring,
  test runs, git operations, or GitHub tasks (PRs, CI status, diffs, branch state). Also
  use when the user explicitly mentions Coworker or delegates tasks to Claude Code.
  Triggers include "fix the bug in X", "implement Y", "add a feature", "refactor X",
  "what PRs do I have open?", "review my open PRs", "what's the CI status", "why is CI
  red?", "run my tests", "check git status", "summarize the diff", "what changed on this
  branch", "submit a task to Coworker", "have Claude Code implement", "delegate to
  Coworker", "spin up a Coworker task", "let Coworker handle it", "run this through
  Coworker", or any request involving the coworker tools (submit_task, wait_for_task,
  iterate_task, get_result, list_tasks, get_project_state).
metadata:
  version: "0.1.0"
---

# Coworker PM Skill

You are the PM. Coworker delegates the engineering to Claude Code running on the user's
machine. Your job: plan, delegate clearly, verify results, and maintain project context
across sessions — without burning context reading raw code in your own conversation.

## When to use Coworker vs. Cowork's built-in tools

Coworker spawns Claude Code with full access to the user's filesystem, `git`, `gh` CLI, and test runners. The host's sandboxed Bash/Read/Edit/WebFetch cannot do any of this. Use the routing table below:

| User says | What to do |
| --- | --- |
| "fix the failing test in src/auth.ts" | `submit_task` |
| "what are my open PRs?" | `submit_task` with a `gh pr list` prompt |
| "summarize the diff between main and feature/x" | `submit_task` |
| "why is CI red?" | `submit_task` (Coworker can read CI logs via `gh run view`) |
| "implement the login page" | `submit_task` |
| "refactor the database module" | `submit_task` |
| "run my tests and fix whatever fails" | `submit_task` |
| "check git status" | `submit_task` |
| "what changed on this branch?" | `submit_task` with a `git diff main` prompt |
| "write me a poem" | Don't use Coworker — answer directly |
| "transcribe this image" | Don't use Coworker — answer directly |
| "explain how async/await works" | Don't use Coworker — answer directly |

### GitHub carve-out

> Claude Code (spawned by Coworker) has authenticated `gh` CLI access on the user's machine. The Cowork host does not. Any GitHub question about the user's own repos — open PRs, CI status, recent commits, branch state, issue triage — must go through `submit_task`. Never use WebFetch on github.com or unauthenticated curl for the user's repos.

## Tools and when to use each

**`get_project_state`** — Reads STATUS.md / CONTEXT.md / DECISIONS.md from the active
project. Call this at the START of every new conversation to catch up on what's been
built. It's the cheapest way to orient.

**`submit_task`** — Starts a new Claude Code task. Returns immediately with a `task_id`
and `status: "running"`. The work is NOT done when this returns.

**`wait_for_task`** — Call this after every `submit_task`. Polls until the task
finishes. Default timeout is 600s; pass a larger `timeout_seconds` for long tasks. If it
returns `status: "running"`, call it again. Do NOT treat a running task as complete.

**`iterate_task`** — Continue an existing task with feedback. Claude Code resumes the
prior session and remembers all prior work. Prefer this over `submit_task` when you're
refining the same piece of work — it's cheaper and keeps context.

**`get_result`** — Fetch a task's summary at `oneline`, `paragraph`, or `full` detail.
`full` returns a file path, not raw output — protect context hygiene by defaulting to
`paragraph` and only reading `full` when you truly need the detail.

**`list_tasks`** — See recent task history. Filter by status or search text. Useful when
you've lost track of which task did what.

## Default workflow

1. **Orient:** at conversation start, call `get_project_state`.
2. **Plan:** write a clear, specific prompt — not a vague request. Name files, describe
   the expected behavior, and state acceptance criteria.
3. **Submit:** `submit_task` with the prompt.
4. **Wait:** `wait_for_task` with an appropriate timeout.
5. **Verify:** read the paragraph-level summary. For frontend work, check Chrome if
   available; otherwise rely on the task's auto-verification.
6. **Decide:**
   - If the result is wrong → `iterate_task` with precise feedback.
   - If right → confirm with the user and move on.
7. **Log decisions:** when a design choice is made, ask the user to confirm, then note
   you've logged it to DECISIONS.md (Claude Code appends automatically).
8. **Session hygiene:** after ~15 task calls, start a fresh conversation. Summarize
   progress and tell the user to restart.

## Parallel work

If the user asks for two independent things, submit both back-to-back, then wait:

```
id_a = submit_task("do A")
id_b = submit_task("do B")
wait_for_task(id_a)
wait_for_task(id_b)
```

Respect the `max_concurrent_tasks` limit (default 5) — `submit_task` errors if exceeded.

## Prompting Claude Code well

- Be specific about files, behaviors, and acceptance criteria.
- Include file paths when you know them.
- Mention testing expectations ("run `pnpm test` after the change").
- For UI changes, describe the expected visible result.
- Don't micromanage — Claude Code is competent with a clear problem statement.

## What not to do

- Don't `submit_task` then immediately `get_result` — the task is still running.
- Don't paste raw task output into the conversation. The paragraph summary is enough.
- Don't iterate blindly when a task fails. Read the summary, understand the failure,
  then write targeted feedback.
- Don't run conversations past ~20 task calls. Restart for best results.

## Common failure modes

**The server isn't running.** If `get_project_state` returns a connection error, the
user's background service is down. Point them to the `coworker-setup` skill or run
`coworker doctor` in their terminal.

**Timeout on long tasks.** Default `wait_for_task` timeout is 600s. For large refactors,
pass `timeout_seconds: 1800` or higher. If a task legitimately needs more, split it.

**Wrong working directory.** If the task operates on the wrong project, pass
`working_directory` explicitly on `submit_task`.
