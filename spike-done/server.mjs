import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

// Create a fresh server per request (stateless mode)
function createServer() {
  const server = new McpServer({
    name: 'coworker-spike',
    version: '0.0.1',
  });

  server.registerTool('ping', {
    description: 'A simple ping tool to verify the MCP bridge works end-to-end.',
    inputSchema: {},
  }, async () => {
    const now = new Date().toISOString();
    return {
      content: [
        {
          type: 'text',
          text: `pong! Coworker spike server is alive. Server time: ${now}`,
        },
      ],
    };
  });

  return server;
}

// Plain express app — no host validation since we're behind a tunnel
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
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

app.get('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST.' },
    id: null,
  });
});

app.delete('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'coworker-spike' });
});

const PORT = process.env.PORT || 17429;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMCP spike server listening on http://localhost:${PORT}/mcp`);
  console.log('Waiting for tunnel...\n');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
