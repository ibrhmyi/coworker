// Quick smoke test: run submitTask against a real Claude Code invocation
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb, closeDb } from '../../src/core/store.js';
import { ensureCoworkerDirs } from '../../src/utils/paths.js';
import { submitTask } from '../../src/core/dispatcher.js';

async function main() {
  // Set up a temp project directory
  const projectDir = mkdtempSync(join(tmpdir(), 'coworker-smoke-'));
  console.log('Project dir:', projectDir);

  // Initialize coworker dirs and database
  ensureCoworkerDirs(projectDir);
  initDb(join(projectDir, '.coworker', 'tasks.db'));

  console.log('Submitting task...');
  const result = await submitTask(
    {
      prompt: 'Say "hello from Coworker" and nothing else. Do not use any tools.',
      timeout_seconds: 30,
    },
    projectDir,
  );

  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));

  closeDb();
  console.log('\nSmoke test complete. Check:', projectDir);
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
