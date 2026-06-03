import { Command } from 'commander';
import kleur from 'kleur';
import { buildRuntime } from '../runtime.js';

export function statusCommand() {
  return new Command('status')
    .description('Print index status and provider health')
    .option('--json', 'emit status as JSON for scripting')
    .action(async (opts: { json?: boolean }) => {
      const rt = await buildRuntime();
      const [embedOk, llmOk, chunks] = await Promise.all([
        rt.embed.health(), rt.llm.health(), rt.lance.count(),
      ]);
      const documents = rt.manifest.size();
      const bm25Docs = rt.bm25.size();
      if (opts.json) {
        process.stdout.write(JSON.stringify({
          workspace: rt.workspace,
          documents,
          chunks,
          bm25Docs,
          embed: embedOk ? 'ok' : 'down',
          llm: llmOk ? 'ok' : 'down',
          ok: embedOk && llmOk,
        }) + '\n');
        return;
      }
      process.stdout.write([
        kleur.bold('ClawMind status'),
        `  workspace : ${rt.workspace}`,
        `  documents : ${documents}`,
        `  chunks    : ${chunks}`,
        `  bm25 docs : ${bm25Docs}`,
        `  embed     : ${embedOk ? kleur.green('ok') : kleur.red('down')}`,
        `  llm       : ${llmOk ? kleur.green('ok') : kleur.red('down')}`,
      ].join('\n') + '\n');
    });
}
