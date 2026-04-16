import { runClaudeCode } from './subprocess.js';

export async function buildSummary(
  fullOutput: string,
  opts?: { mode?: 'heuristic' | 'llm'; workingDir?: string; binaryPath?: string },
): Promise<{ oneline: string; paragraph: string }> {
  const mode = opts?.mode ?? 'heuristic';

  if (mode === 'llm' && opts?.workingDir) {
    try {
      return await buildLlmSummary(fullOutput, opts.workingDir, opts.binaryPath);
    } catch {
      // Fall back to heuristic silently
      return buildHeuristicSummary(fullOutput);
    }
  }

  return buildHeuristicSummary(fullOutput);
}

async function buildLlmSummary(
  fullOutput: string,
  workingDir: string,
  binaryPath?: string,
): Promise<{ oneline: string; paragraph: string }> {
  // Send the last 4000 chars — that's where the result usually is
  const truncated = fullOutput.slice(-4000);

  const prompt = `Summarize this Claude Code task output. Provide two summaries:

1. ONELINE: One sentence, max 200 characters. What was accomplished or what failed. No markdown.
2. PARAGRAPH: 2-4 sentences, max 800 characters. What was done, key files changed, any issues. Minimal markdown.

Format your response exactly as:
ONELINE: <summary>
PARAGRAPH: <summary>

Task output (last portion):
${truncated}`;

  const result = await runClaudeCode({
    prompt,
    workingDir,
    timeoutSeconds: 30,
    outputPath: '/dev/null',
    maxTurns: 1,
    binaryPath,
  });

  if (result.exitCode !== 0) {
    throw new Error('LLM summary call failed');
  }

  return parseLlmSummaryResponse(result.stdout);
}

/** Parse ONELINE/PARAGRAPH format from LLM response */
export function parseLlmSummaryResponse(stdout: string): { oneline: string; paragraph: string } {
  // Extract the text content from JSON output
  let text = '';
  for (const line of stdout.split('\n')) {
    try {
      const json = JSON.parse(line.trim());
      if (json.result && typeof json.result === 'string') {
        text = json.result;
        break;
      }
      if (json.type === 'assistant' && json.message?.content) {
        const block = json.message.content.find((c: { type?: string; text?: string }) => c.type === 'text' && c.text);
        if (block?.text) { text = block.text; break; }
      }
    } catch { /* skip non-JSON */ }
  }

  if (!text) {
    throw new Error('No text in LLM response');
  }

  const onelineMatch = text.match(/ONELINE:\s*(.+)/);
  const paragraphMatch = text.match(/PARAGRAPH:\s*([\s\S]+?)(?=$)/);

  const oneline = onelineMatch?.[1]?.trim().slice(0, 200) ?? 'Task completed.';
  const paragraph = paragraphMatch?.[1]?.trim().slice(0, 800) ?? oneline;

  return { oneline, paragraph };
}

export function buildHeuristicSummary(fullOutput: string): { oneline: string; paragraph: string } {
  const lines = fullOutput.split('\n').filter((l) => l.trim());
  const messages: Array<{ type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> }; result?: string }> = [];

  for (const line of lines) {
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Skip non-JSON lines
    }
  }

  let text = '';

  // Try: single JSON result object
  for (const msg of [...messages].reverse()) {
    if (msg.result && typeof msg.result === 'string') {
      text = msg.result;
      break;
    }
  }

  // Fallback: assistant messages
  if (!text) {
    for (const msg of [...messages].reverse()) {
      if (msg.type === 'assistant' && msg.message?.content) {
        const textBlock = msg.message.content.find((c) => c.type === 'text' && c.text);
        if (textBlock?.text) {
          text = textBlock.text;
          break;
        }
      }
    }
  }

  if (!text) {
    return {
      oneline: 'Task completed with no final message.',
      paragraph: 'Task completed with no final message.',
    };
  }

  // Strip markdown formatting
  const cleaned = text
    .replace(/^#+\s+.*/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const sentences = splitSentences(cleaned);
  const oneline = (sentences[0]?.trim() ?? 'Task completed.').slice(0, 200);
  const paragraph = sentences.slice(0, 4).join(' ').trim().slice(0, 800);

  return { oneline, paragraph };
}

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    current += text[i];
    const char = text[i];
    const next = text[i + 1];

    if ((char === '.' || char === '!' || char === '?') && (next === ' ' || next === undefined)) {
      parts.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}
