import { Command } from 'commander';
import kleur from 'kleur';
import { buildRuntime } from '../runtime.js';

export function statusCommand() {
  return new Command('status')
    .description('Print index status and provider health')
    .action(async () => {
      const rt = await buildRuntime();
      const [embedOk, llmOk, chunks] = await Promise.all([
        rt.embed.health(), rt.llm.health(), rt.lance.count(),
      ]);
      process.stdout.write([
        kleur.bold('ClawMind status'),
        `  workspace : ${rt.workspace}`,
        `  documents : ${rt.manifest.size()}`,
        `  chunks    : ${chunks}`,
        `  bm25 docs : ${rt.bm25.size()}`,
        `  embed     : ${embedOk ? kleur.green('ok') : kleur.red('down')}`,
        `  llm       : ${llmOk ? kleur.green('ok') : kleur.red('down')}`,
      ].join('\n') + '\n');
    });
}
