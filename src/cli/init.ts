import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getCoworkerDir, ensureCoworkerDirs, getDbPath } from '../utils/paths.js';
import { initDb, closeDb } from '../core/store.js';
import { DEFAULT_CONFIG_YAML } from '../core/config.js';
import { INITIAL_STATUS_MD, INITIAL_CONTEXT_MD, INITIAL_DECISIONS_MD } from '../core/state.js';

export async function init(directory?: string): Promise<void> {
  const projectDir = resolve(directory ?? process.cwd());
  const coworkerDir = getCoworkerDir(projectDir);

  if (existsSync(coworkerDir)) {
    console.log(`Already initialized: ${coworkerDir}`);
    return;
  }

  // Create directory structure
  ensureCoworkerDirs(projectDir);

  // Write config.yaml
  writeFileSync(join(coworkerDir, 'config.yaml'), DEFAULT_CONFIG_YAML, 'utf-8');

  // Write .gitignore
  writeFileSync(join(coworkerDir, '.gitignore'), '*\n', 'utf-8');

  // Write state files
  writeFileSync(join(coworkerDir, 'STATUS.md'), INITIAL_STATUS_MD, 'utf-8');
  writeFileSync(join(coworkerDir, 'CONTEXT.md'), INITIAL_CONTEXT_MD, 'utf-8');
  writeFileSync(join(coworkerDir, 'DECISIONS.md'), INITIAL_DECISIONS_MD, 'utf-8');

  // Initialize SQLite database
  initDb(getDbPath(projectDir));
  closeDb();

  console.log(`Coworker initialized in ${coworkerDir}/\n`);
  console.log('Next steps:');
  console.log(`  1. Edit project context:  nano ${join('.coworker', 'CONTEXT.md')}`);
  console.log('  2. Start the server:      coworker start');
  console.log('  3. Run health check:      coworker doctor');
}
