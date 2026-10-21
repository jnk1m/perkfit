/**
 * Shared start-up for the Qloo scripts. Import this FIRST.
 * 1. `server-only` throws outside React Server builds, so the script re-runs itself once with
 *    Node's `react-server` export condition (the same condition Next.js uses for server code).
 * 2. Loads `.env.local` (never printed).
 * Real Qloo responses stay under `.private/`, which is git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

if (!process.execArgv.some((a) => a.includes('react-server'))) {
  const r = spawnSync(process.execPath, [...process.execArgv, '--conditions=react-server', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

try {
  process.loadEnvFile(path.resolve('.env.local'));
} catch {
  // Falls back to the process environment (CI, Vercel).
}

export const PRIVATE_DIR = path.resolve('.private');

export function readPrivateJson<T>(file: string): T | undefined {
  const p = path.join(PRIVATE_DIR, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined;
}

export function writePrivate(file: string, content: string): string {
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const p = path.join(PRIVATE_DIR, file);
  writeFileSync(p, content);
  return p;
}

export function requireKey(): void {
  if (!process.env.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set. Put it in .env.local (copy from the secrets folder).');
    process.exit(1);
  }
}
