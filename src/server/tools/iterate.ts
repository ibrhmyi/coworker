import * as z from 'zod/v4';
import { iterateTask } from '../../core/dispatcher.js';

export const iterateTaskSchema = {
  task_id: z.string().describe('The task ID to iterate on'),
  feedback: z.string().describe('Follow-up prompt / feedback for Claude Code'),
  timeout_seconds: z.number().optional().describe('Kill after N seconds (default from config)'),
};

export const iterateTaskToolConfig = {
  description: "Continue an existing task with feedback. Returns immediately with a new task ID. Use wait_for_task to get the result.",
  inputSchema: iterateTaskSchema,
};

export function handleIterateTask(
  args: { task_id: string; feedback: string; timeout_seconds?: number },
  projectDir?: string,
) {
  try {
    const result = iterateTask(
      { task_id: args.task_id, feedback: args.feedback, timeout_seconds: args.timeout_seconds },
      projectDir,
    );

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}
