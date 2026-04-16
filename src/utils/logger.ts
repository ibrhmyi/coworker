import pino from 'pino';
import { join } from 'node:path';
import { getLogDir } from './paths.js';

let logger: pino.Logger | undefined;

export function getLogger(projectDir?: string): pino.Logger {
  if (logger) return logger;

  const logDir = getLogDir(projectDir);
  const logPath = join(logDir, 'coworker.log');

  logger = pino(
    { level: 'info' },
    pino.destination({ dest: logPath, sync: false }),
  );

  return logger;
}

export function getConsoleLogger(): pino.Logger {
  if (logger) return logger;
  logger = pino({ level: 'info' });
  return logger;
}
