// E2E test: start the MCP server and call all 4 tools via HTTP
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../../src/server/mcp.js';
import { closeDb } from '../../src/core/store.js';

async function mcpCall(port: number, method: string, params: unknown, id: number = 1) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  const text = await res.text();
  // Parse SSE response
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'coworker-e2e-'));
  console.log('Project dir:', projectDir);

  const { server, actualPort } = await startServer(0, projectDir);
  console.log(`Server running on port ${actualPort}\n`);

  try {
    // 1. Initialize
    console.log('=== Initialize ===');
    const init = await mcpCall(actualPort, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0' },
    });
    console.log('Protocol version:', init.result.protocolVersion);
    console.log('Server:', init.result.serverInfo.name, init.result.serverInfo.version);

    // 2. List tools
    console.log('\n=== Tools List ===');
    const tools = await mcpCall(actualPort, 'tools/list', {}, 2);
    const toolNames = tools.result.tools.map((t: { name: string }) => t.name);
    console.log('Tools:', toolNames.join(', '));

    if (toolNames.length !== 4) {
      throw new Error(`Expected 4 tools, got ${toolNames.length}`);
    }

    // 3. List tasks (should be empty)
    console.log('\n=== List Tasks (empty) ===');
    const emptyList = await mcpCall(actualPort, 'tools/call', {
      name: 'list_tasks',
      arguments: {},
    }, 3);
    const emptyResult = JSON.parse(emptyList.result.content[0].text);
    console.log('Total tasks:', emptyResult.total_count);

    // 4. Submit a task
    console.log('\n=== Submit Task ===');
    const submit = await mcpCall(actualPort, 'tools/call', {
      name: 'submit_task',
      arguments: {
        prompt: 'Say "hello from Coworker e2e test" and nothing else. Do not use any tools.',
        timeout_seconds: 30,
      },
    }, 4);
    const submitResult = JSON.parse(submit.result.content[0].text);
    console.log('Task ID:', submitResult.task_id);
    console.log('Status:', submitResult.status);
    console.log('Summary:', submitResult.summary);
    console.log('Duration:', submitResult.duration_seconds, 's');
    console.log('Session ID:', submitResult.claude_session_id);

    const taskId = submitResult.task_id;
    const sessionId = submitResult.claude_session_id;

    // 5. Get result at each level
    console.log('\n=== Get Result (oneline) ===');
    const oneline = await mcpCall(actualPort, 'tools/call', {
      name: 'get_result',
      arguments: { task_id: taskId, level: 'oneline' },
    }, 5);
    console.log(JSON.parse(oneline.result.content[0].text).content);

    console.log('\n=== Get Result (paragraph) ===');
    const para = await mcpCall(actualPort, 'tools/call', {
      name: 'get_result',
      arguments: { task_id: taskId, level: 'paragraph' },
    }, 6);
    console.log(JSON.parse(para.result.content[0].text).content);

    console.log('\n=== Get Result (full) ===');
    const full = await mcpCall(actualPort, 'tools/call', {
      name: 'get_result',
      arguments: { task_id: taskId, level: 'full' },
    }, 7);
    const fullResult = JSON.parse(full.result.content[0].text);
    console.log('Path:', fullResult.result_path);
    console.log('Content:', fullResult.content);

    // 6. List tasks (should have 1)
    console.log('\n=== List Tasks (after submit) ===');
    const afterList = await mcpCall(actualPort, 'tools/call', {
      name: 'list_tasks',
      arguments: {},
    }, 8);
    const afterResult = JSON.parse(afterList.result.content[0].text);
    console.log('Total tasks:', afterResult.total_count);
    console.log('First task:', afterResult.tasks[0].task_id, '-', afterResult.tasks[0].oneline_summary);

    // 7. Iterate on the task
    if (sessionId) {
      console.log('\n=== Iterate Task ===');
      const iterate = await mcpCall(actualPort, 'tools/call', {
        name: 'iterate_task',
        arguments: {
          task_id: taskId,
          feedback: 'Now say "iteration works!" and nothing else. Do not use any tools.',
          timeout_seconds: 30,
        },
      }, 9);
      const iterateResult = JSON.parse(iterate.result.content[0].text);
      console.log('New Task ID:', iterateResult.task_id);
      console.log('Parent:', iterateResult.parent_task_id);
      console.log('Status:', iterateResult.status);
      console.log('Summary:', iterateResult.summary);
    } else {
      console.log('\n=== Skipping iterate (no session ID) ===');
    }

    console.log('\n✓ All e2e checks passed!');
  } catch (err) {
    console.error('\n✗ E2E test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    closeDb();
    console.log('\nServer stopped. Project dir:', projectDir);
  }
}

main();
