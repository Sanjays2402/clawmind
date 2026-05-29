import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '@clawmind/types';

export class AuditLog {
  constructor(private readonly file: string) {}

  async write(event: Omit<AuditEvent, 'id' | 'ts'>) {
    const full: AuditEvent = { id: randomUUID(), ts: Date.now(), ...event };
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }
}
