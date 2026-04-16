import * as z from 'zod/v4';
import { submitTask } from '../../core/dispatcher.js';

export const submitTaskSchema = {
  prompt: z.string().describe('The task description to send to Claude Code'),
  working_directory: z.string().optional().describe('Override the default working directory'),
  allowed_tools: z.array(z.string()).optional().describe('Restrict Claude Code tools for this task'),
  max_turns: z.number().optional().describe('Cap the number of iterations'),
  timeout_seconds: z.number().optional().describe('Kill after N seconds (default 600)'),
};

export const submitTaskToolConfig = {
  description:
    'Submit a new coding task to Claude Code. Returns immediately with a task ID. Use wait_for_task to get the result when done.',
  inputSchema: submitTaskSchema,
};

export function handleSubmitTask(
  args: {
    prompt: string;
    working_directory?: string;
    allowed_tools?: string[];
    max_turns?: number;
    timeout_seconds?: number;
  },
  projectDir?: string,
) {
  try {
    const result = submitTask(
      {
        prompt: args.prompt,
        working_directory: args.working_directory,
        allowed_tools: args.allowed_tools,
        max_turns: args.max_turns,
        timeout_seconds: args.timeout_seconds,
      },
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
