import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb, createTask, updateTask } from '../../src/core/store.js';
import {
  updateStatusFile,
  readContextFile,
  prependContext,
  getProjectState,
  INITIAL_STATUS_MD,
  INITIAL_CONTEXT_MD,
  INITIAL_DECISIONS_MD,
} from '../../src/core/state.js';
import type { Task } from '../../src/types/task.js';

describe('state', () => {
  let tmpDir: string;
  let coworkerDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coworker-state-'));
    coworkerDir = join(tmpDir, '.coworker');
    mkdirSync(coworkerDir, { recursive: true });
    mkdirSync(join(coworkerDir, 'results'), { recursive: true });
    initDb(join(coworkerDir, 'tasks.db'));

    // Write initial state files
    writeFileSync(join(coworkerDir, 'STATUS.md'), INITIAL_STATUS_MD, 'utf-8');
    writeFileSync(join(coworkerDir, 'CONTEXT.md'), INITIAL_CONTEXT_MD, 'utf-8');
    writeFileSync(join(coworkerDir, 'DECISIONS.md'), INITIAL_DECISIONS_MD, 'utf-8');
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('updateStatusFile', () => {
    it('writes STATUS.md with task summaries', () => {
      const task: Task = {
        task_id: 'task_test_001',
        status: 'running',
        created_at: new Date().toISOString(),
        prompt: 'Fix the bug',
        working_directory: tmpDir,
        timeout_seconds: 120,
        output_path: join(coworkerDir, 'results', 'task_test_001', 'output.md'),
        prompt_path: join(coworkerDir, 'results', 'task_test_001', 'prompt.md'),
      };
      createTask(task);
      updateTask('task_test_001', {
        status: 'done',
        completed_at: new Date().toISOString(),
        duration_seconds: 5.2,
        oneline_summary: 'Fixed the bug in auth module',
      });

      updateStatusFile(tmpDir);

      const content = readFileSync(join(coworkerDir, 'STATUS.md'), 'utf-8');
      expect(content).toContain('task_test_001');
      expect(content).toContain('done');
      expect(content).toContain('1 tasks completed');
    });

    it('shows (none) when no tasks', () => {
      updateStatusFile(tmpDir);
      const content = readFileSync(join(coworkerDir, 'STATUS.md'), 'utf-8');
      expect(content).toContain('(none)');
      expect(content).toContain('0 tasks completed');
    });
  });

  describe('readContextFile', () => {
    it('returns undefined for short content', () => {
      writeFileSync(join(coworkerDir, 'CONTEXT.md'), 'Short note', 'utf-8');
      const result = readContextFile(tmpDir);
      expect(result).toBeUndefined();
    });

    it('returns content when CONTEXT.md has real content (>200 chars)', () => {
      const realContent = '# Project Context\n\n' + 'A'.repeat(250);
      writeFileSync(join(coworkerDir, 'CONTEXT.md'), realContent, 'utf-8');

      const result = readContextFile(tmpDir);
      expect(result).toBe(realContent);
    });

    it('returns undefined for default template (contains placeholder text)', () => {
      // The default template contains "Describe your project here", so it's skipped
      const result = readContextFile(tmpDir);
      expect(result).toBeUndefined();
    });

    it('returns undefined when file does not exist', () => {
      rmSync(join(coworkerDir, 'CONTEXT.md'));
      const result = readContextFile(tmpDir);
      expect(result).toBeUndefined();
    });
  });

  describe('prependContext', () => {
    it('returns prompt unchanged when context is too short', () => {
      writeFileSync(join(coworkerDir, 'CONTEXT.md'), 'Short', 'utf-8');
      const result = prependContext('Do the thing', tmpDir);
      expect(result).toBe('Do the thing');
    });

    it('prepends context when CONTEXT.md has real content', () => {
      const realContent = '# Project Context\n\n' + 'B'.repeat(250);
      writeFileSync(join(coworkerDir, 'CONTEXT.md'), realContent, 'utf-8');

      const result = prependContext('Do the thing', tmpDir);
      expect(result).toContain('## Project Context');
      expect(result).toContain(realContent);
      expect(result).toContain('## Task\nDo the thing');
    });
  });

  describe('getProjectState', () => {
    it('returns all state files by default', () => {
      const state = getProjectState(tmpDir, ['all']);
      expect(state.content).toContain('Project Status');
      expect(state.content).toContain('Project Context');
      expect(state.content).toContain('Decisions Log');
      expect(state.taskCount).toBe(0);
      expect(state.lastTaskAt).toBeUndefined();
    });

    it('filters to specific sections', () => {
      const state = getProjectState(tmpDir, ['status']);
      expect(state.content).toContain('Project Status');
      expect(state.content).not.toContain('Decisions Log');
    });

    it('includes task count and last task timestamp', () => {
      const task: Task = {
        task_id: 'task_test_002',
        status: 'running',
        created_at: '2026-04-14T10:00:00.000Z',
        prompt: 'Add feature',
        working_directory: tmpDir,
        timeout_seconds: 120,
        output_path: join(coworkerDir, 'results', 'task_test_002', 'output.md'),
        prompt_path: join(coworkerDir, 'results', 'task_test_002', 'prompt.md'),
      };
      createTask(task);
      updateTask('task_test_002', { status: 'done', completed_at: new Date().toISOString() });

      const state = getProjectState(tmpDir, ['all']);
      expect(state.taskCount).toBe(1);
      expect(state.lastTaskAt).toBe('2026-04-14T10:00:00.000Z');
    });
  });
});
