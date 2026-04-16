export type TaskStatus = 'running' | 'done' | 'failed';

export interface Task {
  task_id: string;
  parent_task_id?: string;
  status: TaskStatus;
  created_at: string;
  completed_at?: string;
  duration_seconds?: number;
  prompt: string;
  working_directory: string;
  allowed_tools?: string[];
  max_turns?: number;
  timeout_seconds: number;
  claude_session_id?: string;
  exit_code?: number;
  failure_reason?: string;
  oneline_summary?: string;
  paragraph_summary?: string;
  output_path: string;
  prompt_path: string;
  verification_passed?: boolean;
  verification_attempts?: number;
}

export interface TaskListFilters {
  status?: TaskStatus | 'all';
  limit?: number;
  sinceHours?: number;
  search?: string;
}

export interface SubmitTaskInput {
  prompt: string;
  working_directory?: string;
  allowed_tools?: string[];
  max_turns?: number;
  timeout_seconds?: number;
}

export interface SubmitTaskResult {
  task_id: string;
  status: 'running';
  message: string;
}

export interface TaskCompletionResult {
  task_id: string;
  status: 'done' | 'failed';
  summary: string;
  result_path: string;
  duration_seconds: number;
  claude_session_id: string;
}

export interface IterateTaskInput {
  task_id: string;
  feedback: string;
  timeout_seconds?: number;
}

export interface IterateTaskResult {
  task_id: string;
  parent_task_id: string;
  status: 'running';
  message: string;
}

export interface WaitForTaskInput {
  task_id: string;
  timeout_seconds?: number;
}

export interface WaitForTaskResult {
  task_id: string;
  status: TaskStatus;
  summary?: string;
  result_path?: string;
  duration_seconds?: number;
  claude_session_id?: string;
  message?: string;
}

export interface GetResultInput {
  task_id: string;
  level?: 'oneline' | 'paragraph' | 'full';
}

export interface GetResultOutput {
  task_id: string;
  status: TaskStatus;
  level: 'oneline' | 'paragraph' | 'full';
  content: string;
  result_path?: string;
}

export interface ListTasksInput {
  status?: TaskStatus | 'all';
  limit?: number;
  since_hours?: number;
  search?: string;
}

export interface ListTasksOutput {
  tasks: Array<{
    task_id: string;
    status: TaskStatus;
    created_at: string;
    duration_seconds: number;
    prompt_preview: string;
    oneline_summary: string;
    parent_task_id?: string;
  }>;
  total_count: number;
  returned_count: number;
}

export interface ClaudeCodeResult {
  sessionId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
