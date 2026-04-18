#!/usr/bin/env node

import { Command } from 'commander';
import { init } from './cli/init.js';
import { start } from './cli/start.js';
import { setup } from './cli/setup.js';
import { history } from './cli/history.js';
import { show } from './cli/show.js';
import { doctor } from './cli/doctor.js';
import { tunnelSetup } from './cli/tunnel-setup.js';
import { url } from './cli/url.js';
import { installService, uninstallService } from './cli/service.js';

const program = new Command();

program
  .name('coworker')
  .description('Turn Cowork into an autonomous PM for Claude Code')
  .version('0.1.0');

program
  .command('init [directory]')
  .description('Initialize Coworker in a project directory')
  .action(init);

program
  .command('start')
  .description('Start the MCP server and Cloudflare tunnel')
  .option('--port <number>', 'Port to listen on')
  .action(start);

program
  .command('setup [directory]')
  .description('One-command setup: check deps, init project, start server')
  .option('--stable', 'Also run named-tunnel setup for a permanent URL')
  .action((directory, opts) => setup(directory, opts));

program
  .command('history')
  .description('List recent tasks')
  .option('--limit <number>', 'Max tasks to show', '20')
  .option('--status <status>', 'Filter by status (running, done, failed, all)')
  .action(history);

program
  .command('show <task_id>')
  .description('Show task details')
  .option('--level <level>', 'Detail level (oneline, paragraph, full)', 'paragraph')
  .action(show);

program
  .command('doctor')
  .description('Run health checks')
  .action(doctor);

program
  .command('tunnel-setup')
  .description('Set up a permanent Cloudflare tunnel URL')
  .option('--name <name>', 'Tunnel name', 'coworker')
  .action(tunnelSetup);

program
  .command('url')
  .description('Print (and copy to clipboard) the current connector URL')
  .action(url);

program
  .command('install-service')
  .description('Install Coworker as a background service (launchd/systemd)')
  .action(installService);

program
  .command('uninstall-service')
  .description('Remove the Coworker background service')
  .action(uninstallService);

program.parse();
