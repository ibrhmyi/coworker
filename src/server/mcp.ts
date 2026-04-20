import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { initDb, markOrphanedTasks } from '../core/store.js';
import { ensureCoworkerDirs, getDbPath } from '../utils/paths.js';
import { submitTaskToolConfig, handleSubmitTask } from './tools/submit.js';
import { getResultToolConfig, handleGetResult } from './tools/get.js';
import { iterateTaskToolConfig, handleIterateTask } from './tools/iterate.js';
import { listTasksToolConfig, handleListTasks } from './tools/list.js';
import { getProjectStateToolConfig, handleGetProjectState } from './tools/state.js';
import { waitForTaskToolConfig, handleWaitForTask } from './tools/wait.js';
import { killAllProcesses } from '../core/processes.js';

// Conversation-length counter (resets on server restart)
let taskCallCount = 0;
const NUDGE_THRESHOLD = 15;
const NUDGE_MESSAGE = 'Note: This conversation has handled many tasks. For best results, consider starting a fresh conversation and calling get_project_state to catch up.';

function maybeAppendNudge(result: { content: Array<{ type: string; text: string }> }) {
  if (taskCallCount >= NUDGE_THRESHOLD) {
    const lastContent = result.content[result.content.length - 1];
    if (lastContent && lastContent.type === 'text') {
      try {
        const parsed = JSON.parse(lastContent.text);
        parsed.nudge = NUDGE_MESSAGE;
        lastContent.text = JSON.stringify(parsed, null, 2);
      } catch {
        result.content.push({ type: 'text', text: JSON.stringify({ nudge: NUDGE_MESSAGE }) });
      }
    }
  }
  return result;
}

function createMcpServer(projectDir: string): McpServer {
  const server = new McpServer({
    name: 'coworker',
    version: '0.1.0',
  });

  server.registerTool('submit_task', {
    description: "Submit a coding task to Claude Code. Returns immediately with a task ID. Use wait_for_task to get the result.",
    inputSchema: submitTaskToolConfig.inputSchema,
  }, async (args) => {
    taskCallCount++;
    const result = handleSubmitTask(args as Parameters<typeof handleSubmitTask>[0], projectDir);
    return maybeAppendNudge(result);
  });

  server.registerTool('wait_for_task', {
    description: "Wait for a running task to complete. Returns the full result once done. If already complete, returns immediately.",
    inputSchema: waitForTaskToolConfig.inputSchema,
  }, async (args) => {
    return handleWaitForTask(args as Parameters<typeof handleWaitForTask>[0]);
  });

  server.registerTool('get_result', {
    description: "Get the result of a completed task at a specified detail level (oneline, paragraph, or full path).",
    inputSchema: getResultToolConfig.inputSchema,
  }, async (args) => {
    return handleGetResult(args as Parameters<typeof handleGetResult>[0]);
  });

  server.registerTool('iterate_task', {
    description: "Continue an existing task with feedback. Returns immediately with a new task ID. Use wait_for_task to get the result.",
    inputSchema: iterateTaskToolConfig.inputSchema,
  }, async (args) => {
    taskCallCount++;
    const result = handleIterateTask(args as Parameters<typeof handleIterateTask>[0], projectDir);
    return maybeAppendNudge(result);
  });

  server.registerTool('list_tasks', {
    description: "List recent tasks with compact summaries. Use to check what's been run without scanning your own history.",
    inputSchema: listTasksToolConfig.inputSchema,
  }, async (args) => {
    return handleListTasks(args as Parameters<typeof handleListTasks>[0]);
  });

  server.registerTool('get_project_state', {
    description: "Get the current project state including status, context, and decisions. Use this at the start of a new conversation to catch up on what's been built.",
    inputSchema: getProjectStateToolConfig.inputSchema,
  }, async (args) => {
    return handleGetProjectState(args as Parameters<typeof handleGetProjectState>[0], projectDir);
  });

  return server;
}

export async function startStdioServer(projectDir: string): Promise<void> {
  ensureCoworkerDirs(projectDir);
  initDb(getDbPath(projectDir));

  const orphaned = markOrphanedTasks(1);
  if (orphaned > 0) {
    process.stderr.write(`Marked ${orphaned} orphaned task(s) as failed.\n`);
  }

  taskCallCount = 0;

  const server = createMcpServer(projectDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes; no return.
}

export async function startServer(port: number, projectDir: string): Promise<{
  app: ReturnType<typeof express>;
  server: ReturnType<ReturnType<typeof express>['listen']>;
  actualPort: number;
}> {
  ensureCoworkerDirs(projectDir);
  initDb(getDbPath(projectDir));

  const orphaned = markOrphanedTasks(1);
  if (orphaned > 0) {
    console.log(`Marked ${orphaned} orphaned task(s) as failed.`);
  }

  // Reset conversation counter on server start
  taskCallCount = 0;

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const mcpServer = createMcpServer(projectDir);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        mcpServer.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'coworker', version: '0.1.0', tasks_this_session: taskCallCount });
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, '0.0.0.0', () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ app, server: httpServer, actualPort });
    });
    httpServer.on('error', (err) => {
      reject(err);
    });
  });
}

/** Kill all running Claude Code subprocesses. Called on server shutdown. */
export function shutdownProcesses(): void {
  killAllProcesses();
}
