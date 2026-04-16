import * as z from 'zod/v4';
import { getTask } from '../../core/store.js';

export const getResultSchema = {
  task_id: z.string().describe('The task ID to look up'),
  level: z.enum(['oneline', 'paragraph', 'full']).optional().describe('Detail level (default: paragraph)'),
};

export const getResultToolConfig = {
  description: "Get the result of a completed task at a specified detail level (oneline, paragraph, or full path).",
  inputSchema: getResultSchema,
};

export async function handleGetResult(args: { task_id: string; level?: 'oneline' | 'paragraph' | 'full' }) {
  const level = args.level ?? 'paragraph';
  const task = getTask(args.task_id);

  if (!task) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${args.task_id}. Use list_tasks to see available tasks.` }) }],
      isError: true,
    };
  }

  if (task.status === 'running') {
    const elapsed = Math.round((Date.now() - new Date(task.created_at).getTime()) / 1000);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          task_id: task.task_id,
          status: 'running',
          level,
          content: `Task is still running. Started ${elapsed}s ago. Use wait_for_task to wait for completion.`,
        }),
      }],
    };
  }

  let content: string;
  let result_path: string | undefined;

  switch (level) {
    case 'oneline':
      content = task.oneline_summary ?? 'No summary available.';
      break;
    case 'full':
      content = task.paragraph_summary ?? 'No summary available.';
      result_path = task.output_path;
      break;
    case 'paragraph':
    default:
      content = task.paragraph_summary ?? 'No summary available.';
      break;
  }

  const result: Record<string, unknown> = {
    task_id: task.task_id,
    status: task.status,
    level,
    content,
  };
  if (result_path) result.result_path = result_path;

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
