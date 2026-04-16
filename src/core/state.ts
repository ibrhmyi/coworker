import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCoworkerDir } from '../utils/paths.js';
import { listTasks } from './store.js';

export const INITIAL_STATUS_MD = `# Project Status
Last updated: (no tasks yet)

## Recent Tasks
(none)

## Current State
0 tasks completed, 0 failed, 0 running
`;

export const INITIAL_CONTEXT_MD = `# Project Context
<!-- Coworker prepends this to every Claude Code task. Update it to give Claude Code persistent project awareness. -->

## What we're building
(Describe your project here, or let Cowork fill this in during your first conversation)

## Tech stack
(Languages, frameworks, key dependencies)

## Key constraints
(Design decisions, requirements, things to avoid)
`;

export const INITIAL_DECISIONS_MD = `# Decisions Log
<!-- Key architectural and product decisions. Append-only. -->
`;

export function updateStatusFile(projectDir: string): void {
  const statusPath = join(getCoworkerDir(projectDir), 'STATUS.md');

  const { tasks, totalCount } = listTasks({ limit: 10 });

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const runningCount = tasks.filter((t) => t.status === 'running').length;

  const taskLines = tasks.map((t) => {
    const dur = t.duration_seconds != null ? `${t.duration_seconds.toFixed(1)}s` : 'running';
    const summary = t.oneline_summary ?? t.prompt.slice(0, 80);
    return `- [${t.task_id}] ${t.status} (${dur}) — ${summary}`;
  });

  const content = `# Project Status
Last updated: ${new Date().toISOString()}

## Recent Tasks
${taskLines.length > 0 ? taskLines.join('\n') : '(none)'}

## Current State
${doneCount} tasks completed, ${failedCount} failed, ${runningCount} running (${totalCount} total)
`;

  writeFileSync(statusPath, content, 'utf-8');
}

export function readContextFile(projectDir: string): string | undefined {
  const contextPath = join(getCoworkerDir(projectDir), 'CONTEXT.md');
  if (!existsSync(contextPath)) return undefined;

  const content = readFileSync(contextPath, 'utf-8').trim();
  // Skip if it's still the default template or too short to be useful
  if (content.includes('Describe your project here') || content.length <= 100) return undefined;
  return content;
}

export function prependContext(prompt: string, projectDir: string): string {
  const context = readContextFile(projectDir);
  if (!context) return prompt;
  return `## Project Context\n${context}\n\n## Task\n${prompt}`;
}

export function readStateFile(projectDir: string, filename: string): string {
  const filePath = join(getCoworkerDir(projectDir), filename);
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8');
}

export function getProjectState(
  projectDir: string,
  include: string[] = ['all'],
): { content: string; taskCount: number; lastTaskAt?: string } {
  const sections: string[] = [];
  const shouldInclude = (key: string) => include.includes('all') || include.includes(key);

  if (shouldInclude('status')) {
    const status = readStateFile(projectDir, 'STATUS.md');
    if (status) sections.push(status);
  }

  if (shouldInclude('context')) {
    const context = readStateFile(projectDir, 'CONTEXT.md');
    if (context) sections.push(context);
  }

  if (shouldInclude('decisions')) {
    const decisions = readStateFile(projectDir, 'DECISIONS.md');
    if (decisions) sections.push(decisions);
  }

  const { tasks, totalCount } = listTasks({ limit: 1 });
  const lastTaskAt = tasks.length > 0 ? tasks[0].created_at : undefined;

  return {
    content: sections.join('\n---\n\n'),
    taskCount: totalCount,
    lastTaskAt,
  };
}
