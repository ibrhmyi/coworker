import { findProjectRoot, getDbPath } from '../utils/paths.js';
import { initDb, listTasks, closeDb } from '../core/store.js';
import type { TaskStatus } from '../types/task.js';

export async function history(opts: { limit?: string; status?: string }): Promise<void> {
  const projectDir = findProjectRoot();
  if (!projectDir) {
    console.error('No .coworker/ directory found. Run `coworker init` first.');
    process.exit(1);
  }

  initDb(getDbPath(projectDir));

  try {
    const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
    const status = opts.status as TaskStatus | 'all' | undefined;

    const { tasks, totalCount } = listTasks({ status, limit });

    if (tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }

    // Header
    const cols = {
      id: 28,
      status: 8,
      duration: 10,
      created: 20,
      prompt: 50,
    };

    console.log(
      pad('ID', cols.id) +
      pad('Status', cols.status) +
      pad('Duration', cols.duration) +
      pad('Created', cols.created) +
      'Prompt',
    );
    console.log('-'.repeat(cols.id + cols.status + cols.duration + cols.created + cols.prompt));

    for (const task of tasks) {
      const duration = task.duration_seconds != null ? `${task.duration_seconds.toFixed(1)}s` : '-';
      const created = task.created_at.replace('T', ' ').slice(0, 19);
      const prompt = task.prompt.slice(0, cols.prompt).replace(/\n/g, ' ');

      console.log(
        pad(task.task_id, cols.id) +
        pad(task.status, cols.status) +
        pad(duration, cols.duration) +
        pad(created, cols.created) +
        prompt,
      );
    }

    if (totalCount > tasks.length) {
      console.log(`\n(${totalCount} total, showing ${tasks.length})`);
    }
  } finally {
    closeDb();
  }
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len - 1) + ' ' : str + ' '.repeat(len - str.length);
}
