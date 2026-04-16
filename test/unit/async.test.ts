import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask, updateTask, getTask } from '../../src/core/store.js';
import { waitForTask } from '../../src/core/dispatcher.js';
import { handleSubmitTask } from '../../src/server/tools/submit.js';
import { handleIterateTask } from '../../src/server/tools/iterate.js';
import { handleWaitForTask } from '../../src/server/tools/wait.js';
import type { Task } from '../../src/types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_test_001',
    status: 'done',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 5.0,
    prompt: 'Original task',
    working_directory: '/tmp/project',
    timeout_seconds: 600,
    claude_session_id: 'sess_abc123',
    output_path: '/tmp/results/task_test_001/output.md',
    prompt_path: '/tmp/results/task_test_001/prompt.md',
    oneline_summary: 'Done.',
    paragraph_summary: 'Done successfully.',
    ...overrides,
  };
}

describe('async task flow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-async-'));
    initDb(join(tmpDir, 'tasks.db'));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('wait_for_task', () => {
    it('returns immediately for completed task', async () => {
      createTask(makeTask({ task_id: 'task_done_001', status: 'done' }));
      updateTask('task_done_001', {
        status: 'done',
        paragraph_summary: 'Task completed successfully.',
        duration_seconds: 3.5,
        claude_session_id: 'sess_123',
      });

      const result = await waitForTask('task_done_001', 10);
      expect(result.status).toBe('done');
      expect(result.summary).toBe('Task completed successfully.');
      expect(result.duration_seconds).toBe(3.5);
    });

    it('returns immediately for failed task', async () => {
      createTask(makeTask({ task_id: 'task_fail_001', status: 'failed' }));
      updateTask('task_fail_001', {
        status: 'failed',
        paragraph_summary: 'Task failed: timeout',
        duration_seconds: 600,
      });

      const result = await waitForTask('task_fail_001', 10);
      expect(result.status).toBe('failed');
      expect(result.summary).toContain('failed');
    });

    it('throws for nonexistent task', async () => {
      await expect(waitForTask('nonexistent', 10)).rejects.toThrow('not found');
    });

    it('times out for perpetually running task', async () => {
      createTask(makeTask({ task_id: 'task_run_001', status: 'running' }));

      const result = await waitForTask('task_run_001', 3);
      expect(result.status).toBe('running');
      expect(result.message).toContain('Still running');
    });

    it('polls and returns when task completes', async () => {
      createTask(makeTask({ task_id: 'task_poll_001', status: 'running' }));

      // Simulate task completing after 1 second
      setTimeout(() => {
        updateTask('task_poll_001', {
          status: 'done',
          paragraph_summary: 'Polled and found complete.',
          duration_seconds: 1.5,
          claude_session_id: 'sess_456',
        });
      }, 1000);

      const result = await waitForTask('task_poll_001', 10);
      expect(result.status).toBe('done');
      expect(result.summary).toBe('Polled and found complete.');
    });
  });

  describe('handleWaitForTask', () => {
    it('returns error for nonexistent task', async () => {
      const result = await handleWaitForTask({ task_id: 'nonexistent', timeout_seconds: 3 });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('not found');
    });
  });

  describe('iterate_task async', () => {
    it('rejects iteration on nonexistent task', () => {
      const result = handleIterateTask({ task_id: 'nonexistent', feedback: 'fix it' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('not found');
    });

    it('rejects iteration on running task', () => {
      createTask(makeTask({ status: 'running', claude_session_id: 'sess_abc' }));
      const result = handleIterateTask({ task_id: 'task_test_001', feedback: 'fix it' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('running');
    });

    it('rejects iteration on task with no session ID', () => {
      createTask(makeTask({ claude_session_id: undefined }));
      const result = handleIterateTask({ task_id: 'task_test_001', feedback: 'fix it' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('no session ID');
    });
  });
});
