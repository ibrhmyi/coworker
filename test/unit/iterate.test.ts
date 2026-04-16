import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask, getTask } from '../../src/core/store.js';
import { handleIterateTask } from '../../src/server/tools/iterate.js';
import type { Task } from '../../src/types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_parent_001',
    status: 'done',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 5.0,
    prompt: 'Original task',
    working_directory: '/tmp/project',
    timeout_seconds: 600,
    claude_session_id: 'sess_abc123',
    output_path: '/tmp/results/task_parent_001/output.md',
    prompt_path: '/tmp/results/task_parent_001/prompt.md',
    oneline_summary: 'Done.',
    paragraph_summary: 'Done successfully.',
    ...overrides,
  };
}

describe('handleIterateTask validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-test-'));
    initDb(join(tmpDir, 'tasks.db'));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects iteration on nonexistent task', async () => {
    const result = await handleIterateTask({ task_id: 'nonexistent', feedback: 'fix it' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not found');
  });

  it('rejects iteration on running task', async () => {
    createTask(makeTask({ status: 'running', claude_session_id: 'sess_abc' }));
    const result = await handleIterateTask({ task_id: 'task_parent_001', feedback: 'fix it' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('running');
  });

  it('rejects iteration on task with no session ID', async () => {
    createTask(makeTask({ claude_session_id: undefined }));
    const result = await handleIterateTask({ task_id: 'task_parent_001', feedback: 'fix it' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('no session ID');
  });
});
