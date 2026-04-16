import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask } from '../../src/core/store.js';
import { handleListTasks } from '../../src/server/tools/list.js';
import type { Task } from '../../src/types/task.js';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    task_id: id,
    status: 'done',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 3.0,
    prompt: `Task ${id}`,
    working_directory: '/tmp/project',
    timeout_seconds: 600,
    output_path: `/tmp/results/${id}/output.md`,
    prompt_path: `/tmp/results/${id}/prompt.md`,
    oneline_summary: `Completed ${id}.`,
    paragraph_summary: `Completed ${id} successfully.`,
    ...overrides,
  };
}

describe('handleListTasks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-test-'));
    initDb(join(tmpDir, 'tasks.db'));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists all tasks by default', async () => {
    createTask(makeTask('t1'));
    createTask(makeTask('t2', { status: 'failed' }));
    createTask(makeTask('t3', { status: 'running' }));

    const result = await handleListTasks({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_count).toBe(3);
    expect(parsed.returned_count).toBe(3);
  });

  it('filters by status', async () => {
    createTask(makeTask('t1', { status: 'done' }));
    createTask(makeTask('t2', { status: 'failed' }));

    const result = await handleListTasks({ status: 'failed' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_count).toBe(1);
    expect(parsed.tasks[0].task_id).toBe('t2');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) createTask(makeTask(`t${i}`));

    const result = await handleListTasks({ limit: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.returned_count).toBe(2);
    expect(parsed.total_count).toBe(5);
  });

  it('searches by prompt substring', async () => {
    createTask(makeTask('t1', { prompt: 'Fix auth bug' }));
    createTask(makeTask('t2', { prompt: 'Add logging' }));

    const result = await handleListTasks({ search: 'auth' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_count).toBe(1);
    expect(parsed.tasks[0].task_id).toBe('t1');
  });

  it('returns prompt_preview truncated to 80 chars', async () => {
    const longPrompt = 'A'.repeat(200);
    createTask(makeTask('t1', { prompt: longPrompt }));

    const result = await handleListTasks({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tasks[0].prompt_preview.length).toBe(80);
  });

  it('includes parent_task_id for iterations', async () => {
    createTask(makeTask('t1'));
    createTask(makeTask('t2', { parent_task_id: 't1' }));

    const result = await handleListTasks({});
    const parsed = JSON.parse(result.content[0].text);
    const iterationTask = parsed.tasks.find((t: { task_id: string }) => t.task_id === 't2');
    expect(iterationTask.parent_task_id).toBe('t1');
  });
});
