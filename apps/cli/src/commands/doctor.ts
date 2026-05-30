import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface Finding {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  hint?: string;
}

interface DoctorReport {
  ok: boolean;
  counts: { manifestDocs: number; manifestChunks: number; bm25Chunks: number; lanceChunks: number };
  findings: Finding[];
}

const SEV_COLOR: Record<Finding['severity'], (s: string) => string> = {
  info: kleur.cyan,
  warn: kleur.yellow,
  error: kleur.red,
};

const SEV_LABEL: Record<Finding['severity'], string> = {
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export function doctorCommand() {
  return new Command('doctor')
    .description('Diagnose drift between the manifest, BM25 index, and vector store')
    .option('--json', 'emit machine-readable JSON instead of a text report')
    .action(async (opts: { json?: boolean }) => {
      const env = loadEnv();
      const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
      const res = await fetch(`${base}/v1/doctor`);
      if (!res.ok) throw new Error(`GET /v1/doctor -> ${res.status}: ${await res.text()}`);
      const r = (await res.json()) as DoctorReport;

      if (opts.json) {
        process.stdout.write(JSON.stringify(r, null, 2) + '\n');
        if (!r.ok) process.exitCode = 1;
        return;
      }

      const head = r.ok ? kleur.green('healthy') : kleur.red('problems detected');
      process.stdout.write(kleur.bold(`ClawMind doctor: ${head}\n`));
      process.stdout.write(kleur.gray(
        `  manifest ${r.counts.manifestDocs} docs / ${r.counts.manifestChunks} chunks  ` +
        `bm25 ${r.counts.bm25Chunks}  lance ${r.counts.lanceChunks}\n\n`,
      ));

      if (r.findings.length === 0) {
        process.stdout.write(kleur.green('nothing to report.\n'));
        return;
      }

      for (const f of r.findings) {
        const color = SEV_COLOR[f.severity];
        process.stdout.write(`${color(SEV_LABEL[f.severity])} ${kleur.bold(f.code)}  ${f.message}\n`);
        if (f.hint) process.stdout.write(kleur.gray(`        ${f.hint}\n`));
      }

      if (!r.ok) process.exitCode = 1;
    });
}
