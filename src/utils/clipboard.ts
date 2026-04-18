import { execSync } from 'node:child_process';

/** Copy text to the system clipboard. Returns true on success, false otherwise. */
export function copyToClipboard(text: string): boolean {
  const payload = JSON.stringify(text);

  try {
    if (process.platform === 'darwin') {
      execSync(`printf '%s' ${payload} | pbcopy`, { shell: '/bin/bash', stdio: 'ignore' });
      return true;
    }

    if (process.platform === 'linux') {
      try {
        execSync(`printf '%s' ${payload} | xclip -selection clipboard`, { shell: '/bin/bash', stdio: 'ignore' });
        return true;
      } catch {
        try {
          execSync(`printf '%s' ${payload} | xsel --clipboard`, { shell: '/bin/bash', stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      }
    }

    if (process.platform === 'win32') {
      execSync(`echo ${payload} | clip`, { stdio: 'ignore' });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
