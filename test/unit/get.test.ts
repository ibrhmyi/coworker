import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask } from '../../src/core/store.js';
import { handleGetResult } from '../../src/server/tools/get.js';
import type { Task } from '../../src/types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: 'task_test_001',
    status: 'done',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 5.2,
    prompt: 'Fix the auth bug',
    working_directory: '/tmp/project',
    timeout_seconds: 600,
    output_path: '/tmp/project/.coworker/results/task_test_001/output.md',
    prompt_path: '/tmp/project/.coworker/results/task_test_001/prompt.md',
    oneline_summary: 'Fixed the null check in auth.ts.',
    paragraph_summary: 'Fixed the null check in auth.ts. The issue was on line 42 where req.user could be undefined. Added a guard clause and tests now pass.',
    ...overrides,
  };
}

describe('handleGetResult', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-test-'));
    initDb(join(tmpDir, 'tasks.db'));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error for unknown task', async () => {
    const result = await handleGetResult({ task_id: 'nonexistent' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('not found');
  });

  it('returns oneline summary', async () => {
    createTask(makeTask());
    const result = await handleGetResult({ task_id: 'task_test_001', level: 'oneline' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.level).toBe('oneline');
    expect(parsed.content).toBe('Fixed the null check in auth.ts.');
  });

  it('returns paragraph summary by default', async () => {
    createTask(makeTask());
    const result = await handleGetResult({ task_id: 'task_test_001' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.level).toBe('paragraph');
    expect(parsed.content).toContain('guard clause');
  });

  it('returns paragraph + path for full level', async () => {
    createTask(makeTask());
    const result = await handleGetResult({ task_id: 'task_test_001', level: 'full' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.level).toBe('full');
    expect(parsed.result_path).toBe('/tmp/project/.coworker/results/task_test_001/output.md');
    expect(parsed.content).toContain('guard clause');
  });

  it('returns running status for in-progress tasks', async () => {
    createTask(makeTask({ status: 'running', oneline_summary: undefined, paragraph_summary: undefined }));
    const result = await handleGetResult({ task_id: 'task_test_001' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('running');
    expect(parsed.content).toContain('Task is still running');
    expect(parsed.content).toContain('wait_for_task');
  });
});
