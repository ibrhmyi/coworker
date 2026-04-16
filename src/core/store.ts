import Database from 'better-sqlite3';
import type { Task, TaskListFilters } from '../types/task.js';

let db: Database.Database | undefined;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  duration_seconds REAL,
  prompt TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  allowed_tools TEXT,
  max_turns INTEGER,
  timeout_seconds INTEGER NOT NULL,
  claude_session_id TEXT,
  exit_code INTEGER,
  failure_reason TEXT,
  oneline_summary TEXT,
  paragraph_summary TEXT,
  output_path TEXT NOT NULL,
  prompt_path TEXT NOT NULL,
  verification_passed BOOLEAN,
  verification_attempts INTEGER DEFAULT 0,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(task_id)
)`;

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)',
];

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLE);
  for (const idx of CREATE_INDEXES) {
    db.exec(idx);
  }
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function createTask(task: Task): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO tasks (
      task_id, parent_task_id, status, created_at, completed_at, duration_seconds,
      prompt, working_directory, allowed_tools, max_turns, timeout_seconds,
      claude_session_id, exit_code, failure_reason,
      oneline_summary, paragraph_summary, output_path, prompt_path,
      verification_passed, verification_attempts
    ) VALUES (
      @task_id, @parent_task_id, @status, @created_at, @completed_at, @duration_seconds,
      @prompt, @working_directory, @allowed_tools, @max_turns, @timeout_seconds,
      @claude_session_id, @exit_code, @failure_reason,
      @oneline_summary, @paragraph_summary, @output_path, @prompt_path,
      @verification_passed, @verification_attempts
    )
  `);
  stmt.run({
    task_id: task.task_id,
    parent_task_id: task.parent_task_id ?? null,
    status: task.status,
    created_at: task.created_at,
    completed_at: task.completed_at ?? null,
    duration_seconds: task.duration_seconds ?? null,
    prompt: task.prompt,
    working_directory: task.working_directory,
    allowed_tools: task.allowed_tools ? JSON.stringify(task.allowed_tools) : null,
    max_turns: task.max_turns ?? null,
    timeout_seconds: task.timeout_seconds,
    claude_session_id: task.claude_session_id ?? null,
    exit_code: task.exit_code ?? null,
    failure_reason: task.failure_reason ?? null,
    oneline_summary: task.oneline_summary ?? null,
    paragraph_summary: task.paragraph_summary ?? null,
    output_path: task.output_path,
    prompt_path: task.prompt_path,
    verification_passed: task.verification_passed ?? null,
    verification_attempts: task.verification_attempts ?? 0,
  });
}

export function updateTask(taskId: string, updates: Partial<Task>): void {
  const d = getDb();
  const fields: string[] = [];
  const values: Record<string, unknown> = { task_id: taskId };

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'task_id') continue;
    const dbKey = key;
    fields.push(`${dbKey} = @${dbKey}`);
    if (key === 'allowed_tools' && Array.isArray(value)) {
      values[dbKey] = JSON.stringify(value);
    } else {
      values[dbKey] = value ?? null;
    }
  }

  if (fields.length === 0) return;

  const stmt = d.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE task_id = @task_id`);
  stmt.run(values);
}

export function getTask(taskId: string): Task | undefined {
  const d = getDb();
  const row = d.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToTask(row);
}

export function listTasks(filters: TaskListFilters = {}): { tasks: Task[]; totalCount: number } {
  const d = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.sinceHours) {
    const since = new Date(Date.now() - filters.sinceHours * 3600_000).toISOString();
    conditions.push('created_at >= ?');
    params.push(since);
  }

  if (filters.search) {
    conditions.push('prompt LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 20, 100);

  const countRow = d.prepare(`SELECT COUNT(*) as cnt FROM tasks ${where}`).get(...params) as { cnt: number };
  const rows = d.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit) as Record<string, unknown>[];

  return {
    tasks: rows.map(rowToTask),
    totalCount: countRow.cnt,
  };
}

export function markOrphanedTasks(maxAgeHours: number = 1): number {
  const d = getDb();
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const result = d.prepare(`
    UPDATE tasks SET status = 'failed', failure_reason = 'orphaned', completed_at = ?
    WHERE status = 'running' AND created_at < ?
  `).run(new Date().toISOString(), cutoff);
  return result.changes;
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    task_id: row.task_id as string,
    parent_task_id: row.parent_task_id as string | undefined,
    status: row.status as Task['status'],
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | undefined,
    duration_seconds: row.duration_seconds as number | undefined,
    prompt: row.prompt as string,
    working_directory: row.working_directory as string,
    allowed_tools: row.allowed_tools ? JSON.parse(row.allowed_tools as string) : undefined,
    max_turns: row.max_turns as number | undefined,
    timeout_seconds: row.timeout_seconds as number,
    claude_session_id: row.claude_session_id as string | undefined,
    exit_code: row.exit_code as number | undefined,
    failure_reason: row.failure_reason as string | undefined,
    oneline_summary: row.oneline_summary as string | undefined,
    paragraph_summary: row.paragraph_summary as string | undefined,
    output_path: row.output_path as string,
    prompt_path: row.prompt_path as string,
    verification_passed: row.verification_passed as boolean | undefined,
    verification_attempts: row.verification_attempts as number | undefined,
  };
}
