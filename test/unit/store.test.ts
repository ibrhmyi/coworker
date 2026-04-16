import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask, getTask, updateTask, listTasks, markOrphanedTasks } from '../../src/core/store.js';
import type { Task } from '../../src/types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: `task_20260414_120000_abc123`,
    status: 'running',
    created_at: new Date().toISOString(),
    prompt: 'Write hello world',
    working_directory: '/tmp/test',
    timeout_seconds: 600,
    output_path: '/tmp/test/.coworker/results/task_20260414_120000_abc123/output.md',
    prompt_path: '/tmp/test/.coworker/results/task_20260414_120000_abc123/prompt.md',
    ...overrides,
  };
}

describe('store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-test-'));
    initDb(join(tmpDir, 'tasks.db'));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes the database and creates the table', () => {
    // If initDb didn't throw, the table was created
    const task = getTask('nonexistent');
    expect(task).toBeUndefined();
  });

  it('creates and retrieves a task', () => {
    const task = makeTask();
    createTask(task);

    const retrieved = getTask(task.task_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.task_id).toBe(task.task_id);
    expect(retrieved!.status).toBe('running');
    expect(retrieved!.prompt).toBe('Write hello world');
    expect(retrieved!.timeout_seconds).toBe(600);
  });

  it('updates specific task fields', () => {
    const task = makeTask();
    createTask(task);

    updateTask(task.task_id, {
      status: 'done',
      completed_at: new Date().toISOString(),
      duration_seconds: 12.5,
      claude_session_id: 'sess_abc',
      oneline_summary: 'Created hello world.',
      paragraph_summary: 'Created a hello world script. It prints hello world to stdout.',
    });

    const updated = getTask(task.task_id);
    expect(updated!.status).toBe('done');
    expect(updated!.duration_seconds).toBe(12.5);
    expect(updated!.claude_session_id).toBe('sess_abc');
    expect(updated!.oneline_summary).toBe('Created hello world.');
  });

  it('stores and retrieves allowed_tools as JSON', () => {
    const task = makeTask({ allowed_tools: ['Read', 'Write', 'Bash'] });
    createTask(task);

    const retrieved = getTask(task.task_id);
    expect(retrieved!.allowed_tools).toEqual(['Read', 'Write', 'Bash']);
  });

  it('lists tasks with filters', () => {
    createTask(makeTask({ task_id: 'task_1', status: 'done', prompt: 'first task' }));
    createTask(makeTask({ task_id: 'task_2', status: 'failed', prompt: 'second task' }));
    createTask(makeTask({ task_id: 'task_3', status: 'running', prompt: 'third task' }));

    // All tasks
    const all = listTasks();
    expect(all.totalCount).toBe(3);
    expect(all.tasks).toHaveLength(3);

    // Filter by status
    const done = listTasks({ status: 'done' });
    expect(done.totalCount).toBe(1);
    expect(done.tasks[0].task_id).toBe('task_1');

    // Search
    const searched = listTasks({ search: 'second' });
    expect(searched.totalCount).toBe(1);
    expect(searched.tasks[0].task_id).toBe('task_2');

    // Limit
    const limited = listTasks({ limit: 2 });
    expect(limited.tasks).toHaveLength(2);
    expect(limited.totalCount).toBe(3);
  });

  it('marks orphaned tasks as failed', () => {
    const oldDate = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2 hours ago
    createTask(makeTask({ task_id: 'old_running', status: 'running', created_at: oldDate }));
    createTask(makeTask({ task_id: 'new_running', status: 'running' })); // just now

    const marked = markOrphanedTasks(1);
    expect(marked).toBe(1);

    const old = getTask('old_running');
    expect(old!.status).toBe('failed');
    expect(old!.failure_reason).toBe('orphaned');

    const newTask = getTask('new_running');
    expect(newTask!.status).toBe('running');
  });
});
