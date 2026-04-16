import { describe, it, expect } from 'vitest';
import { buildTunnelArgs, isCloudflaredLoggedIn } from '../../src/server/tunnel.js';

describe('tunnel', () => {
  describe('buildTunnelArgs', () => {
    it('builds quick tunnel args', () => {
      const args = buildTunnelArgs('quick', 3000);
      expect(args).toEqual(['tunnel', '--url', 'http://localhost:3000']);
    });

    it('builds named tunnel args', () => {
      const args = buildTunnelArgs('named', 3000, 'coworker');
      expect(args).toEqual(['tunnel', 'run', '--url', 'http://localhost:3000', 'coworker']);
    });

    it('falls back to quick when no tunnel name for named mode', () => {
      const args = buildTunnelArgs('named', 3000);
      // Without a tunnel name, named mode args still work but cloudflared would error
      expect(args).toEqual(['tunnel', '--url', 'http://localhost:3000']);
    });
  });

  describe('isCloudflaredLoggedIn', () => {
    it('returns a boolean', () => {
      const result = isCloudflaredLoggedIn();
      expect(typeof result).toBe('boolean');
    });
  });
});
