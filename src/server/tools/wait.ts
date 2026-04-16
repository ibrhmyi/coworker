import * as z from 'zod/v4';
import { waitForTask } from '../../core/dispatcher.js';

export const waitForTaskSchema = {
  task_id: z.string().describe('The task ID to wait for'),
  timeout_seconds: z.number().optional().describe('Max time to wait (default 600)'),
};

export const waitForTaskToolConfig = {
  description: "Wait for a running task to complete. Returns the full result once done. If already complete, returns immediately.",
  inputSchema: waitForTaskSchema,
};

export async function handleWaitForTask(args: { task_id: string; timeout_seconds?: number }) {
  try {
    const result = await waitForTask(args.task_id, args.timeout_seconds ?? 600);

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
