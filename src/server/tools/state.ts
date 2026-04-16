import * as z from 'zod/v4';
import { getProjectState } from '../../core/state.js';

export const getProjectStateSchema = {
  include: z.array(z.enum(['status', 'context', 'decisions', 'all'])).optional()
    .describe('Which state files to include (default: ["all"])'),
};

export const getProjectStateToolConfig = {
  description: "Get the current project state including status, context, and decisions. Use this at the start of a new conversation to catch up on what's been built.",
  inputSchema: getProjectStateSchema,
};

export async function handleGetProjectState(
  args: { include?: ('status' | 'context' | 'decisions' | 'all')[] },
  projectDir: string,
) {
  const include = args.include ?? ['all'];
  const state = getProjectState(projectDir, include);

  const result = {
    content: state.content,
    task_count: state.taskCount,
    last_task_at: state.lastTaskAt,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
