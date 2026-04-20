# Cowork plugin directory submission — copy/paste kit

Submit at **https://claude.ai/settings/plugins/submit** (or Console at
https://platform.claude.com/plugins/submit).

Two fields you'll need: the **GitHub URL** and the **description**. The form accepts
either a Git URL or a `.plugin` zip upload. Use the Git URL — updates auto-sync.

## Step 1 — Pre-submission validation

Before you open the form, run:

```bash
cd ~/Documents/Claude/Projects/coworker-source/plugin
claude plugin validate .claude-plugin/plugin.json
```

If `claude plugin validate` isn't available locally, the manual equivalent passed on
2026-04-18 (see `RELEASE.md`):

- `.claude-plugin/plugin.json` — valid JSON, kebab-case name
- `.mcp.json` — valid JSON, `type: http`, loopback URL
- Every `skills/*/SKILL.md` — frontmatter `name` matches directory, `description` present

## Step 2 — Submission form content

### Plugin name
`coworker`

### Short description (for search / card — ≤ 200 chars)
Autonomous PM for Claude Code. Delegate coding tasks to your local Claude Code CLI, iterate with session resumption, keep a running project state — without burning orchestrator context.

### Long description (for the plugin page)
Turn Cowork into an autonomous PM for Claude Code.

This plugin connects Cowork to [Coworker](https://github.com/ibrhmyi/coworker), a local MCP server that delegates coding tasks to the Claude Code CLI on your machine. The orchestrator (Cowork) plans; the worker (Claude Code) executes. You get 80–95% less token use in the orchestrator context vs. doing everything in one conversation, because raw code never enters the orchestrator — only summaries and decisions.

**Six MCP tools over localhost (no tunnel, no manual URL paste):**

- `submit_task` — kick off a Claude Code task async; returns a task_id
- `wait_for_task` — block until a task finishes
- `iterate_task` — continue a task with feedback, Claude Code resumes the prior session
- `get_result` — fetch a task summary at oneline / paragraph / full levels
- `list_tasks` — recent task history with status/search filters
- `get_project_state` — read STATUS.md / CONTEXT.md / DECISIONS.md at conversation start

**Two bundled skills:**

- `coworker-pm` — teaches the orchestrator how and when to delegate, how to
  parallelize, when to iterate vs. submit fresh, and what to avoid
- `coworker-setup` — auto-triggers on MCP connection errors and walks the user
  through `coworker doctor` and one-command install/repair

**Requires:** macOS or Linux, Node.js 20+, Claude Code CLI. One-time setup:
`npx coworker-mcp@latest setup`.

### Source (GitHub repo)
`https://github.com/ibrhmyi/coworker`

If the form asks for a subdirectory path (git-subdir source type):

- **Path:** `plugin`
- **Ref:** `v0.1.1-plugin`

### Homepage
`https://github.com/ibrhmyi/coworker`

### Example use cases

Paste these (one per line) if the form expects bullets; otherwise paste as a paragraph.

- "Add JSDoc to every exported function in `src/utils/*.ts` and run the type check."
- "Convert `src/db/query.ts` from callback style to async/await and update all callers."
- "Fix the failing test in `test/parser.test.ts` — diagnose and patch, don't change the test."
- "Add `GET /api/health/detailed` with DB/cache/uptime checks, route + handler + unit test."
- "Run the full test suite, then open a PR for any flaky tests with the failure logs attached."
- "Implement the `rate_limit` middleware from the spec in `docs/rate-limit.md` — submit as one PR with tests."

### Category / tags
- developer-tools
- agentic-workflows
- code-generation
- mcp-server

### Author
İbrahim Yıldız — https://github.com/ibrhmyi

### License
MIT

## Step 3 — Self-hosted marketplace (bonus, if submission queue is slow)

While awaiting review, users can install directly from the GitHub repo via Claude
Code's marketplace flow:

```bash
claude plugin marketplace add ibrhmyi/coworker
claude plugin install coworker@coworker
```

This requires adding a `.claude-plugin/marketplace.json` at the **repo root** of
`ibrhmyi/coworker`:

```json
{
  "name": "coworker",
  "owner": { "name": "ibrhmyi" },
  "plugins": [
    {
      "name": "coworker",
      "description": "Autonomous PM for Claude Code. Delegate coding tasks to your local Claude Code CLI, iterate with session resumption, keep a running project state.",
      "source": {
        "source": "git-subdir",
        "url": "ibrhmyi/coworker",
        "path": "plugin",
        "ref": "v0.1.1-plugin"
      },
      "homepage": "https://github.com/ibrhmyi/coworker"
    }
  ]
}
```

Commit that alongside the plugin publish and users can install without waiting for
Anthropic's review queue.

## Step 4 — Post-submission

After submission:

- Status appears at the same URL (https://claude.ai/settings/plugins/submit).
- Automated security scan runs first; approval queue is variable.
- Subsequent pushes to `ibrhmyi/coworker` auto-mirror into the public marketplace
  after passing screening — no re-submission needed.
- If rejected, the form shows the reason; fix, push, and it re-scans.

## Common rejection reasons (watch for)

- **Name collision.** `coworker` might conflict with something. If it does, fall back
  to `coworker-claude-code` or `coworker-pm`.
- **Missing SETUP.md guidance.** The docs mention a `SETUP.md` skill convention. Our
  `skills/coworker-setup/SKILL.md` serves this role — if reviewers flag the filename,
  also add `SETUP.md` at the plugin root symlinking to the skill.
- **Unreviewed local MCP.** The `.mcp.json` points to a localhost URL the reviewer
  can't reach. Our bundled `coworker-setup` skill explains the install flow — that
  should cover it, but if rejected, emphasize in the submission description that
  the MCP is bootstrapped by `npx coworker-mcp@latest setup`.
