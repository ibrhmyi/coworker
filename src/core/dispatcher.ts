import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createTask, updateTask, getTask, listTasks } from './store.js';
import { spawnClaudeCode, runClaudeCode } from './subprocess.js';
import { buildSummary } from './summary.js';
import { getTaskDir } from '../utils/paths.js';
import { getDefaultConfig, loadConfig, type CoworkerConfig } from './config.js';
import { prependContext, updateStatusFile } from './state.js';
import { trackProcess, getRunningCount } from './processes.js';
import type { Task, SubmitTaskInput, SubmitTaskResult, IterateTaskInput, IterateTaskResult, WaitForTaskResult } from '../types/task.js';

function generateTaskId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = randomBytes(3).toString('hex');
  return `task_${date}_${time}_${rand}`;
}

function loadProjectConfig(projectDir?: string): CoworkerConfig {
  if (projectDir) {
    try { return loadConfig(projectDir); } catch { /* fall through */ }
  }
  return getDefaultConfig();
}

function runVerificationCommands(
  commands: string[],
  workingDir: string,
  timeoutSeconds: number,
): { passed: boolean; failedCommand?: string; output?: string } {
  for (const cmd of commands) {
    try {
      execSync(cmd, {
        cwd: workingDir,
        timeout: timeoutSeconds * 1000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      const stdout = (err as { stdout?: string }).stdout ?? '';
      return {
        passed: false,
        failedCommand: cmd,
        output: (stdout + '\n' + stderr).trim().slice(0, 2000),
      };
    }
  }
  return { passed: true };
}

export function submitTask(input: SubmitTaskInput, projectDir?: string): SubmitTaskResult {
  const config = loadProjectConfig(projectDir);

  // Enforce concurrent task limit
  const maxConcurrent = config.limits.max_concurrent_tasks;
  if (getRunningCount() >= maxConcurrent) {
    throw new Error(`Maximum concurrent tasks (${maxConcurrent}) reached. Wait for a task to complete.`);
  }

  const taskId = generateTaskId();
  const workingDir = resolve(input.working_directory ?? projectDir ?? process.cwd());
  const taskDir = getTaskDir(taskId, projectDir);
  const outputPath = join(taskDir, 'output.md');
  const promptPath = join(taskDir, 'prompt.md');
  const summaryPath = join(taskDir, 'summary.md');
  const timeoutSeconds = input.timeout_seconds ?? config.claude.default_timeout_seconds;

  const fullPrompt = projectDir ? prependContext(input.prompt, projectDir) : input.prompt;

  mkdirSync(taskDir, { recursive: true });
  writeFileSync(promptPath, fullPrompt, 'utf-8');

  const task: Task = {
    task_id: taskId,
    status: 'running',
    created_at: new Date().toISOString(),
    prompt: input.prompt,
    working_directory: workingDir,
    allowed_tools: input.allowed_tools,
    max_turns: input.max_turns ?? config.claude.default_max_turns,
    timeout_seconds: timeoutSeconds,
    output_path: outputPath,
    prompt_path: promptPath,
  };

  createTask(task);

  // Spawn subprocess and run completion in background
  const startTime = Date.now();
  const { child, result: resultPromise } = spawnClaudeCode({
    prompt: fullPrompt,
    workingDir,
    allowedTools: input.allowed_tools,
    maxTurns: input.max_turns ?? config.claude.default_max_turns,
    timeoutSeconds,
    outputPath,
    binaryPath: config.claude.binary_path,
  });

  trackProcess(taskId, child);

  // Background completion handler
  resultPromise.then(async (result) => {
    try {
      let durationSeconds = (Date.now() - startTime) / 1000;
      let status = result.timedOut ? 'failed' as const : result.exitCode === 0 ? 'done' as const : 'failed' as const;
      let failureReason = result.timedOut ? 'timeout' : result.exitCode !== 0 ? 'nonzero_exit' : undefined;
      let sessionId = result.sessionId;

      let summary = await buildSummary(result.stdout, {
        mode: config.summary.mode,
        workingDir,
        binaryPath: config.claude.binary_path,
      });

      // Auto-verification
      let verificationPassed: boolean | undefined;
      let verificationAttempts = 0;

      if (status === 'done' && config.verification.enabled && config.verification.commands.length > 0) {
        let retriesLeft = config.verification.max_retries;

        while (true) {
          verificationAttempts++;
          const vResult = runVerificationCommands(
            config.verification.commands,
            workingDir,
            config.verification.timeout_seconds,
          );

          if (vResult.passed) {
            verificationPassed = true;
            break;
          }

          if (retriesLeft <= 0) {
            verificationPassed = false;
            summary.paragraph = `${summary.paragraph} [Verification failed after ${verificationAttempts} attempt(s): \`${vResult.failedCommand}\`]`;
            break;
          }

          retriesLeft--;

          const fixPrompt = `The following verification step failed. Fix the issue.\n\nCommand: \`${vResult.failedCommand}\`\nExit code: 1\nOutput:\n\`\`\`\n${vResult.output}\n\`\`\``;

          const fixResult = await runClaudeCode({
            prompt: fixPrompt,
            workingDir,
            resumeSessionId: sessionId || undefined,
            timeoutSeconds,
            outputPath: join(taskDir, `fix_attempt_${verificationAttempts}.md`),
            binaryPath: config.claude.binary_path,
          });

          if (fixResult.sessionId) sessionId = fixResult.sessionId;

          if (fixResult.exitCode !== 0) {
            verificationPassed = false;
            summary.paragraph = `${summary.paragraph} [Verification fix attempt failed]`;
            break;
          }
        }
      }

      durationSeconds = (Date.now() - startTime) / 1000;

      writeFileSync(summaryPath, `# Summary\n\n## One-line\n${summary.oneline}\n\n## Paragraph\n${summary.paragraph}\n`, 'utf-8');

      updateTask(taskId, {
        status,
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        claude_session_id: sessionId || undefined,
        exit_code: result.exitCode,
        failure_reason: failureReason,
        oneline_summary: summary.oneline,
        paragraph_summary: summary.paragraph,
        verification_passed: verificationPassed,
        verification_attempts: verificationAttempts,
      });

      if (projectDir) {
        try { updateStatusFile(projectDir); } catch { /* non-critical */ }
      }
    } catch (error) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      const message = error instanceof Error ? error.message : String(error);

      updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        failure_reason: message,
        oneline_summary: `Task failed: ${message}`,
        paragraph_summary: `Task failed: ${message}`,
      });

      if (projectDir) {
        try { updateStatusFile(projectDir); } catch { /* non-critical */ }
      }
    }
  });

  return {
    task_id: taskId,
    status: 'running',
    message: 'Task submitted. Use wait_for_task or get_result to check progress.',
  };
}

export function iterateTask(input: IterateTaskInput, projectDir?: string): IterateTaskResult {
  const config = loadProjectConfig(projectDir);
  const originalTask = getTask(input.task_id);

  if (!originalTask) {
    throw new Error(`Task not found: ${input.task_id}. Run 'coworker history' to see available tasks.`);
  }
  if (originalTask.status === 'running') {
    throw new Error(`Cannot iterate on task ${input.task_id} — it's still running. Wait for it to complete first.`);
  }
  if (!originalTask.claude_session_id) {
    throw new Error(`Task ${input.task_id} has no session ID — cannot resume. Submit a new task instead.`);
  }

  // Enforce concurrent task limit
  const maxConcurrent = config.limits.max_concurrent_tasks;
  if (getRunningCount() >= maxConcurrent) {
    throw new Error(`Maximum concurrent tasks (${maxConcurrent}) reached. Wait for a task to complete.`);
  }

  const taskId = generateTaskId();
  const taskDir = getTaskDir(taskId, projectDir);
  const outputPath = join(taskDir, 'output.md');
  const promptPath = join(taskDir, 'prompt.md');
  const summaryPath = join(taskDir, 'summary.md');
  const timeoutSeconds = input.timeout_seconds ?? config.claude.default_timeout_seconds;

  mkdirSync(taskDir, { recursive: true });
  writeFileSync(promptPath, input.feedback, 'utf-8');

  const task: Task = {
    task_id: taskId,
    parent_task_id: input.task_id,
    status: 'running',
    created_at: new Date().toISOString(),
    prompt: input.feedback,
    working_directory: originalTask.working_directory,
    timeout_seconds: timeoutSeconds,
    output_path: outputPath,
    prompt_path: promptPath,
  };

  createTask(task);

  const startTime = Date.now();
  const { child, result: resultPromise } = spawnClaudeCode({
    prompt: input.feedback,
    workingDir: originalTask.working_directory,
    resumeSessionId: originalTask.claude_session_id,
    timeoutSeconds,
    outputPath,
    binaryPath: config.claude.binary_path,
  });

  trackProcess(taskId, child);

  // Background completion handler
  resultPromise.then(async (result) => {
    try {
      let resumeFailed = false;

      // If resume failed, retry without resume
      if (result.exitCode !== 0 && !result.timedOut) {
        resumeFailed = true;
        result = await runClaudeCode({
          prompt: input.feedback,
          workingDir: originalTask.working_directory,
          timeoutSeconds,
          outputPath,
          binaryPath: config.claude.binary_path,
        });
      }

      const durationSeconds = (Date.now() - startTime) / 1000;
      const status = result.timedOut ? 'failed' as const : result.exitCode === 0 ? 'done' as const : 'failed' as const;
      const failureReason = result.timedOut ? 'timeout' : result.exitCode !== 0 ? 'nonzero_exit' : undefined;

      const summary = await buildSummary(result.stdout, {
        mode: config.summary.mode,
        workingDir: originalTask.working_directory,
        binaryPath: config.claude.binary_path,
      });
      if (resumeFailed) {
        summary.paragraph = `[Note: session resumption failed, used fresh session] ${summary.paragraph}`;
      }

      writeFileSync(summaryPath, `# Summary\n\n## One-line\n${summary.oneline}\n\n## Paragraph\n${summary.paragraph}\n`, 'utf-8');

      updateTask(taskId, {
        status,
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        claude_session_id: result.sessionId || undefined,
        exit_code: result.exitCode,
        failure_reason: failureReason,
        oneline_summary: summary.oneline,
        paragraph_summary: summary.paragraph,
      });

      if (projectDir) {
        try { updateStatusFile(projectDir); } catch { /* non-critical */ }
      }
    } catch (error) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      const message = error instanceof Error ? error.message : String(error);

      updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        failure_reason: message,
        oneline_summary: `Iteration failed: ${message}`,
        paragraph_summary: `Iteration failed: ${message}`,
      });

      if (projectDir) {
        try { updateStatusFile(projectDir); } catch { /* non-critical */ }
      }
    }
  });

  return {
    task_id: taskId,
    parent_task_id: input.task_id,
    status: 'running',
    message: 'Task submitted. Use wait_for_task or get_result to check progress.',
  };
}

export async function waitForTask(taskId: string, timeoutSeconds: number = 600): Promise<WaitForTaskResult> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found. Use list_tasks to see available tasks.`);
    }

    if (task.status !== 'running') {
      return {
        task_id: task.task_id,
        status: task.status,
        summary: task.paragraph_summary ?? '',
        result_path: task.output_path,
        duration_seconds: task.duration_seconds != null ? Math.round(task.duration_seconds * 10) / 10 : 0,
        claude_session_id: task.claude_session_id ?? '',
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return {
    task_id: taskId,
    status: 'running',
    message: `Still running after ${timeoutSeconds}s. Use wait_for_task again or get_result to check later.`,
  };
}
