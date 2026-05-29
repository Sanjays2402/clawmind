import { createHash } from 'node:crypto';
export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
export function shortHash(s: string): string {
  return sha1(s).slice(0, 12);
}
