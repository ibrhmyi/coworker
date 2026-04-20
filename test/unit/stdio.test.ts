import { describe, it, expect } from 'vitest';
import { startStdioServer } from '../../src/server/mcp.js';

describe('startStdioServer', () => {
  it('is exported and is a function', () => {
    expect(startStdioServer).toBeDefined();
    expect(typeof startStdioServer).toBe('function');
  });
});
