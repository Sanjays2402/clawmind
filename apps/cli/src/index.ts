#!/usr/bin/env -S npx tsx
import { Command } from 'commander';
import { ingestCommand } from './commands/ingest.js';
import { askCommand } from './commands/ask.js';
import { searchCommand } from './commands/search.js';
import { reindexCommand } from './commands/reindex.js';
import { watchCommand } from './commands/watch.js';
import { statusCommand } from './commands/status.js';
import { feedbackCommand } from './commands/feedback.js';
import { digestCommand } from './commands/digest.js';

const program = new Command();
program
  .name('clawmind')
  .description('Local-first RAG over your OpenClaw workspace')
  .version('0.1.0');

program.addCommand(ingestCommand());
program.addCommand(askCommand());
program.addCommand(searchCommand());
program.addCommand(reindexCommand());
program.addCommand(watchCommand());
program.addCommand(statusCommand());
program.addCommand(feedbackCommand());
program.addCommand(digestCommand());

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
