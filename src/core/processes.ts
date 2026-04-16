import type { ChildProcess } from 'node:child_process';

const running = new Map<string, ChildProcess>();

export function trackProcess(taskId: string, child: ChildProcess): void {
  running.set(taskId, child);
  child.on('exit', () => {
    running.delete(taskId);
  });
}

export function getRunningCount(): number {
  return running.size;
}

export function killAllProcesses(): void {
  for (const [taskId, child] of running) {
    try {
      child.kill('SIGTERM');
    } catch { /* already exited */ }
  }
  running.clear();
}
