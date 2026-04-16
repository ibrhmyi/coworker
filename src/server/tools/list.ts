import * as z from 'zod/v4';
import { listTasks } from '../../core/store.js';

export const listTasksSchema = {
  status: z.enum(['running', 'done', 'failed', 'all']).optional().describe('Filter by status (default: all)'),
  limit: z.number().optional().describe('Max results (default 20, max 100)'),
  since_hours: z.number().optional().describe('Only tasks from the last N hours'),
  search: z.string().optional().describe('Substring match on prompt'),
};

export const listTasksToolConfig = {
  description: "List recent tasks with compact summaries. Use to check what's been run without scanning your own history.",
  inputSchema: listTasksSchema,
};

export async function handleListTasks(args: {
  status?: 'running' | 'done' | 'failed' | 'all';
  limit?: number;
  since_hours?: number;
  search?: string;
}) {
  const { tasks, totalCount } = listTasks({
    status: args.status,
    limit: args.limit,
    sinceHours: args.since_hours,
    search: args.search,
  });

  const result = {
    tasks: tasks.map((t) => {
      // For running tasks, show elapsed time so far
      const durationSeconds = t.status === 'running'
        ? Math.round((Date.now() - new Date(t.created_at).getTime()) / 100) / 10
        : (t.duration_seconds ?? 0);

      return {
        task_id: t.task_id,
        status: t.status,
        created_at: t.created_at,
        duration_seconds: durationSeconds,
        prompt_preview: t.prompt.slice(0, 80),
        oneline_summary: t.status === 'running' ? 'Running...' : (t.oneline_summary ?? ''),
        parent_task_id: t.parent_task_id,
      };
    }),
    total_count: totalCount,
    returned_count: tasks.length,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
