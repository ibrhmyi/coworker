import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { execSync } from 'node:child_process';
import type { ClaudeCodeResult } from '../types/task.js';

export function findClaudeBinary(configuredPath?: string): string {
  const binary = configuredPath ?? 'claude';
  try {
    const resolved = execSync(`which ${binary}`, { encoding: 'utf-8' }).trim();
    if (!resolved) throw new Error();
    return resolved;
  } catch {
    throw new Error(
      `Claude Code binary not found (looked for "${binary}"). ` +
      'Run \'coworker doctor\' to diagnose, or install from https://docs.anthropic.com/en/docs/claude-code',
    );
  }
}

export interface SpawnedClaudeCode {
  child: ChildProcess;
  result: Promise<ClaudeCodeResult>;
}

export function spawnClaudeCode(opts: {
  prompt: string;
  workingDir: string;
  resumeSessionId?: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds: number;
  outputPath: string;
  binaryPath?: string;
}): SpawnedClaudeCode {
  const binary = findClaudeBinary(opts.binaryPath);

  const args = ['-p', opts.prompt, '--output-format', 'json', '--dangerously-skip-permissions'];

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  if (opts.maxTurns !== undefined) {
    args.push('--max-turns', String(opts.maxTurns));
  }

  const child = spawn(binary, args, {
    cwd: opts.workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const result = new Promise<ClaudeCodeResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let sessionId = '';

    const outStream = createWriteStream(opts.outputPath, { flags: 'w' });

    child.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      stdout += str;
      outStream.write(str);

      if (!sessionId) {
        sessionId = extractSessionId(str);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutSeconds * 1000);

    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      outStream.end();

      if (!sessionId) {
        sessionId = extractSessionId(stdout);
      }

      resolve({ sessionId, exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });

  return { child, result };
}

/** Convenience wrapper that spawns and awaits (used by verification retry loops) */
export async function runClaudeCode(opts: {
  prompt: string;
  workingDir: string;
  resumeSessionId?: string;
  allowedTools?: string[];
  maxTurns?: number;
  timeoutSeconds: number;
  outputPath: string;
  binaryPath?: string;
}): Promise<ClaudeCodeResult> {
  const { result } = spawnClaudeCode(opts);
  return result;
}

function extractSessionId(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const json = JSON.parse(trimmed);
      if (json.session_id) return json.session_id;
    } catch {
      // Not a complete JSON line, skip
    }
  }
  return '';
}
