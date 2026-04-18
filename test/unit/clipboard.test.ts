import { describe, it, expect } from 'vitest';
import { copyToClipboard } from '../../src/utils/clipboard.js';

describe('copyToClipboard', () => {
  it('returns a boolean', () => {
    const result = copyToClipboard('test-value');
    expect(typeof result).toBe('boolean');
  });

  it('returns true on macOS where pbcopy exists', () => {
    if (process.platform !== 'darwin') return;
    const result = copyToClipboard('coworker-clipboard-test');
    expect(result).toBe(true);
  });

  it('does not throw on arbitrary input', () => {
    expect(() => copyToClipboard('line one\nline two\n"quoted" stuff & | ;')).not.toThrow();
  });
});
