import { describe, it, expect } from 'vitest';
import { getDefaultConfig } from '../../src/core/config.js';

describe('default port', () => {
  it('defaults to 17429 (deterministic)', () => {
    const config = getDefaultConfig();
    expect(config.server.port).toBe(17429);
  });
});
