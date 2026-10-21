#!/usr/bin/env node
// Build output check. Run after `next build`. Prints file paths and rule names, never secret values.
//
// 1. .next/static (the client bundle) and prerendered HTML/RSC under .next/server/app must not contain
//    server-only names or hosts.
// 2. Real secret values from the environment (or .env.local) must not appear anywhere under .next.
//
// Usage: node scripts/check-bundle.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root = path.resolve(rootIdx >= 0 ? args[rootIdx + 1] : process.cwd());
const nextDir = path.join(root, '.next');

const FORBIDDEN = [
  'QLOO_API_KEY',
  'QLOO_BASE_URL',
  'hackathon.api.qloo.com',
  'x-api-key',
  'ANTHROPIC',
  'sk-' + 'ant-',
];
const SECRET_ENV = ['QLOO_API_KEY', 'ANTHROPIC_API_KEY', 'UPSTASH_REDIS_REST_TOKEN', 'PERKFIT_PRECACHE', 'PERKFIT_SECRET'];
const MIN_SECRET_LENGTH = 8;
const MAX_VALUE_SCAN_BYTES = 200 * 1024 * 1024;
const PRERENDERED = /\.(html|rsc|body)$/;

if (!existsSync(path.join(nextDir, 'static'))) {
  console.error(`check-bundle: ${path.join('.next', 'static')} not found under ${root}. Run "npm run build" first.`);
  process.exit(2);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}

function secretValues() {
  const values = new Map();
  const add = (name, value) => {
    if (SECRET_ENV.includes(name) && value && value.length >= MIN_SECRET_LENGTH) values.set(name, value);
  };
  for (const name of SECRET_ENV) add(name, process.env[name]);
  const envFile = path.join(root, '.env.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
      if (m) add(m[1], m[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return values;
}

const failures = [];
const rel = (p) => path.relative(root, p);
const values = secretValues();
const forbiddenLower = FORBIDDEN.map((s) => [s, s.toLowerCase()]);

const nameScanDirs = [path.join(nextDir, 'static'), path.join(nextDir, 'server', 'app')];
for (const dir of nameScanDirs) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (dir.endsWith('app') && !PRERENDERED.test(file)) continue;
    const text = readFileSync(file).toString('latin1').toLowerCase();
    for (const [label, needle] of forbiddenLower) {
      if (text.includes(needle)) failures.push(`${rel(file)} contains forbidden string "${label}"`);
    }
  }
}

for (const file of walk(nextDir)) {
  if (statSync(file).size > MAX_VALUE_SCAN_BYTES) continue;
  const buf = readFileSync(file);
  for (const [name, value] of values) {
    if (buf.includes(value)) failures.push(`${rel(file)} contains the value of ${name}`);
  }
}

if (failures.length > 0) {
  console.error('check-bundle failed:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-bundle ok (${values.size} secret value(s) searched)`);
