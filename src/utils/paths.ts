import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

export function getGlobalCoworkerDir(): string {
  return join(homedir(), '.coworker');
}

export function getGlobalBinDir(): string {
  return join(getGlobalCoworkerDir(), 'bin');
}

export function ensureGlobalDirs(): void {
  const binDir = getGlobalBinDir();
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
}

export function getCoworkerDir(projectDir?: string): string {
  return resolve(projectDir ?? process.cwd(), '.coworker');
}

export function getDbPath(projectDir?: string): string {
  return join(getCoworkerDir(projectDir), 'tasks.db');
}

export function getLogDir(projectDir?: string): string {
  return join(getCoworkerDir(projectDir), 'logs');
}

export function getResultsDir(projectDir?: string): string {
  return join(getCoworkerDir(projectDir), 'results');
}

export function getTaskDir(taskId: string, projectDir?: string): string {
  return join(getResultsDir(projectDir), taskId);
}

export function findProjectRoot(startDir?: string): string | undefined {
  let dir = resolve(startDir ?? process.cwd());
  while (true) {
    if (existsSync(join(dir, '.coworker'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached filesystem root
    dir = parent;
  }
}

export function ensureCoworkerDirs(projectDir?: string): void {
  const base = getCoworkerDir(projectDir);
  for (const dir of [base, getLogDir(projectDir), getResultsDir(projectDir)]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
