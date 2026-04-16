import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod/v4';
import { getCoworkerDir } from '../utils/paths.js';

const claudeSchema = z.object({
  binary_path: z.string().default('claude'),
  default_timeout_seconds: z.number().default(600),
  default_max_turns: z.number().default(20),
  default_allowed_tools: z.array(z.string()).default([]),
  working_directory: z.string().default('.'),
});

const serverSchema = z.object({
  port: z.number().default(0),
  enable_tunnel: z.boolean().default(true),
  tunnel_mode: z.enum(['quick', 'named', 'none']).default('quick'),
  tunnel_name: z.string().default(''),
});

const summarySchema = z.object({
  mode: z.enum(['heuristic', 'llm']).default('heuristic'),
  oneline_max_chars: z.number().default(200),
  paragraph_max_chars: z.number().default(800),
});

const limitsSchema = z.object({
  max_concurrent_tasks: z.number().default(5),
  max_task_age_hours: z.number().default(24),
});

const verificationSchema = z.object({
  enabled: z.boolean().default(false),
  commands: z.array(z.string()).default([]),
  max_retries: z.number().default(2),
  timeout_seconds: z.number().default(60),
});

const configSchema = z.object({
  version: z.number().default(1),
  claude: claudeSchema.default({}),
  server: serverSchema.default({}),
  summary: summarySchema.default({}),
  limits: limitsSchema.default({}),
  verification: verificationSchema.default({}),
});

export type CoworkerConfig = {
  version: number;
  claude: z.infer<typeof claudeSchema>;
  server: z.infer<typeof serverSchema>;
  summary: z.infer<typeof summarySchema>;
  limits: z.infer<typeof limitsSchema>;
  verification: z.infer<typeof verificationSchema>;
};

const DEFAULTS: CoworkerConfig = {
  version: 1,
  claude: { binary_path: 'claude', default_timeout_seconds: 600, default_max_turns: 20, default_allowed_tools: [], working_directory: '.' },
  server: { port: 0, enable_tunnel: true, tunnel_mode: 'quick', tunnel_name: '' },
  summary: { mode: 'heuristic', oneline_max_chars: 200, paragraph_max_chars: 800 },
  limits: { max_concurrent_tasks: 5, max_task_age_hours: 24 },
  verification: { enabled: false, commands: [], max_retries: 2, timeout_seconds: 60 },
};

export function getDefaultConfig(): CoworkerConfig {
  return structuredClone(DEFAULTS);
}

export function loadConfig(projectDir: string): CoworkerConfig {
  const configPath = join(getCoworkerDir(projectDir), 'config.yaml');

  if (!existsSync(configPath)) {
    return getDefaultConfig();
  }

  const raw = readFileSync(configPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config.yaml: ${msg}`);
  }

  if (parsed === undefined || parsed === null) {
    return getDefaultConfig();
  }

  // Deep merge parsed config over defaults, then validate
  const merged = deepMerge(getDefaultConfig(), parsed as Record<string, unknown>);
  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config.yaml:\n${issues}`);
  }

  return result.data as CoworkerConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export const DEFAULT_CONFIG_YAML = `# Coworker project config
version: 1

claude:
  binary_path: claude              # Path to claude binary, or just "claude" if in PATH
  default_timeout_seconds: 600     # Kill tasks after this many seconds
  default_max_turns: 20            # Max Claude Code iterations per task
  default_allowed_tools: []        # Empty = all tools allowed
  working_directory: .             # Relative to project root

server:
  port: 0                          # 0 = random free port
  enable_tunnel: true              # Start a Cloudflare tunnel for remote access
  tunnel_mode: quick               # quick (random URL) | named (permanent URL) | none
  tunnel_name: ""                  # Name for named tunnel (set by 'coworker tunnel-setup')

summary:
  mode: heuristic                  # heuristic (free, fast) or llm (better, costs tokens — v0.2)
  oneline_max_chars: 200
  paragraph_max_chars: 800

limits:
  max_concurrent_tasks: 5
  max_task_age_hours: 24           # Auto-fail tasks older than this

# verification:                    # Uncomment to enable auto-verification
#   enabled: true
#   commands:
#     - npm test
#     - npm run build
#   max_retries: 2                 # Auto-fix attempts before giving up
#   timeout_seconds: 60            # Per verification command
`;
