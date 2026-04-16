import { describe, it, expect } from 'vitest';
import { buildSummary, buildHeuristicSummary, parseLlmSummaryResponse } from '../../src/core/summary.js';

describe('buildSummary (heuristic)', () => {
  it('extracts summary from result field', async () => {
    const output = JSON.stringify({
      result: 'I created the hello world script. It prints "Hello, World!" to the console. The file is at src/hello.ts. You can run it with tsx.',
    });

    const { oneline, paragraph } = await buildSummary(output);
    expect(oneline).toContain('I created the hello world script.');
    expect(paragraph).toContain('I created the hello world script.');
    expect(paragraph).toContain('Hello, World!');
  });

  it('extracts summary from streaming assistant messages', async () => {
    const lines = [
      JSON.stringify({ type: 'system', text: 'Starting...' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I fixed the bug in auth.ts. The issue was a missing null check on line 42. Tests now pass. No other changes were needed.' },
          ],
        },
      }),
    ].join('\n');

    const { oneline, paragraph } = await buildSummary(lines);
    expect(oneline).toBe('I fixed the bug in auth.ts.');
    expect(paragraph).toContain('The issue was a missing null check');
    expect(paragraph).toContain('Tests now pass.');
  });

  it('returns fallback when no assistant message found', async () => {
    const output = JSON.stringify({ type: 'system', text: 'done' });

    const { oneline, paragraph } = await buildSummary(output);
    expect(oneline).toBe('Task completed with no final message.');
    expect(paragraph).toBe('Task completed with no final message.');
  });

  it('handles empty output', async () => {
    const { oneline, paragraph } = await buildSummary('');
    expect(oneline).toBe('Task completed with no final message.');
    expect(paragraph).toBe('Task completed with no final message.');
  });

  it('strips markdown from oneline summary', async () => {
    const output = JSON.stringify({
      result: '## Changes Made\n\n- Fixed the **auth** bug in `auth.ts`.\n- Updated tests.\n\nEverything passes now.',
    });

    const { oneline, paragraph } = await buildSummary(output);
    expect(oneline).not.toContain('#');
    expect(oneline).not.toContain('**');
    expect(oneline).not.toContain('`');
    expect(oneline).not.toContain('- ');
    expect(oneline).not.toContain('\n');
  });

  it('produces genuinely one-line oneline summary', async () => {
    const output = JSON.stringify({
      result: 'First sentence here. Second sentence here. Third sentence here.',
    });

    const { oneline } = await buildSummary(output);
    expect(oneline).toBe('First sentence here.');
  });

  it('truncates long summaries', async () => {
    const longSentence = 'A'.repeat(300) + '. ';
    const output = JSON.stringify({ result: longSentence.repeat(5) });

    const { oneline, paragraph } = await buildSummary(output);
    expect(oneline.length).toBeLessThanOrEqual(200);
    expect(paragraph.length).toBeLessThanOrEqual(800);
  });
});

describe('buildHeuristicSummary (direct)', () => {
  it('works synchronously for direct calls', () => {
    const output = JSON.stringify({ result: 'Done with the task.' });
    const { oneline } = buildHeuristicSummary(output);
    expect(oneline).toBe('Done with the task.');
  });
});

describe('parseLlmSummaryResponse', () => {
  it('parses ONELINE/PARAGRAPH from result field', () => {
    const stdout = JSON.stringify({
      result: 'ONELINE: Fixed the auth bug in login handler.\nPARAGRAPH: Fixed a null pointer exception in the login handler that caused crashes when the session token was expired. Updated auth.ts and added a test case.',
    });

    const { oneline, paragraph } = parseLlmSummaryResponse(stdout);
    expect(oneline).toBe('Fixed the auth bug in login handler.');
    expect(paragraph).toContain('null pointer exception');
    expect(paragraph).toContain('auth.ts');
  });

  it('parses from streaming assistant message', () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'text',
          text: 'ONELINE: Added dark mode toggle.\nPARAGRAPH: Implemented a dark mode toggle in the settings page. Added CSS variables for theme colors and a React context for state management.',
        }],
      },
    });

    const { oneline, paragraph } = parseLlmSummaryResponse(stdout);
    expect(oneline).toBe('Added dark mode toggle.');
    expect(paragraph).toContain('dark mode toggle');
  });

  it('throws on empty response', () => {
    expect(() => parseLlmSummaryResponse('')).toThrow('No text');
  });

  it('falls back gracefully on malformed format', () => {
    const stdout = JSON.stringify({
      result: 'I did the thing and it worked great.',
    });

    const { oneline } = parseLlmSummaryResponse(stdout);
    // No ONELINE: prefix, so falls back to default
    expect(oneline).toBe('Task completed.');
  });

  it('truncates long summaries', () => {
    const longOneline = 'A'.repeat(300);
    const stdout = JSON.stringify({
      result: `ONELINE: ${longOneline}\nPARAGRAPH: Short.`,
    });

    const { oneline } = parseLlmSummaryResponse(stdout);
    expect(oneline.length).toBeLessThanOrEqual(200);
  });
});
