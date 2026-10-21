#!/usr/bin/env node
// Repository hygiene check. Prints rule ids and paths only, never matched values.
//
// Usage:
//   node scripts/check-repo.mjs --all [--history]   tracked and untracked-not-ignored files
//   node scripts/check-repo.mjs --staged            files in the index
//   node scripts/check-repo.mjs --commit-msg <file> commit message file (rule R6)
//   --root <dir>                                    repository root (default: cwd)
//
// R1  Qloo-shaped JSON (entity id plus affinity/explainability/popularity) outside synthetic fixtures,
//     and synthetic fixtures without the _synthetic marker.
// R3  Secret values from .env.local, or the Anthropic key prefix, in tracked files (and history).
// R4  Blocked paths (raw probes, env files, caches, private docs).
// R5  Banned words from a list kept outside the repository (skipped when the list is absent).
// R6  Commit messages with tool trailers, author identities matching the banned list.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = path.resolve(option('--root') ?? process.cwd());
const commitMsgFile = option('--commit-msg');
const modeStaged = flag('--staged');
const modeAll = flag('--all');
const withHistory = flag('--history');

if (!modeStaged && !modeAll && !withHistory && !commitMsgFile) {
  console.error('usage: check-repo.mjs (--all [--history] | --staged | --commit-msg <file>) [--root <dir>]');
  process.exit(2);
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SYNTHETIC_DIR = 'tests/fixtures/synthetic/';
// Patterns are assembled from parts so this file does not trip its own rules.
const ENTITY_KEY = new RegExp('"entity' + '_id"');
const SCORE_KEY = new RegExp('"(affinity|explainability|popularity)"');
const ANTHROPIC_PREFIX = 'sk-' + 'ant-';
const SECRET_NAME = /(KEY|TOKEN|SECRET|PRECACHE)/;
const MIN_SECRET_LENGTH = 8;
const TRAILER = /^\s*(co-authored-by:|claude-session:|.*generated with )/im;

const failures = [];
const fail = (rule, where) => failures.push(`${rule} ${where}`);

function git(gitArgs, opts = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && k !== 'GIT_CONFIG_GLOBAL') delete env[k];
  return execFileSync('git', gitArgs, {
    cwd: root,
    env,
    encoding: opts.buffer ? 'buffer' : 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// --- inputs kept outside the repository ---------------------------------

function loadBannedWords() {
  const file = process.env.PERKFIT_BANNED_FILE ?? path.join(homedir(), 'reward-hq/secrets/perkfit-banned.txt');
  if (!existsSync(file)) {
    console.log('R5 skipped: banned word list not found');
    return [];
  }
  return readLines(file).map((w) => w.toLowerCase());
}

function loadSecretValues() {
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readLines(file)) {
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !SECRET_NAME.test(m[1])) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (value.length >= MIN_SECRET_LENGTH) out.push(value);
  }
  return out;
}

const banned = loadBannedWords();
const secretValues = loadSecretValues();

// --- rules ---------------------------------------------------------------

function isBlockedPath(p) {
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  if (parts.some((s) => s === 'probe-raw' || s === '.private' || s === 'secrets')) return true;
  if (p.startsWith('docs/planning/') || p.startsWith('docs/design/')) return true;
  if (base.startsWith('.env') && base !== '.env.example') return true;
  if (base.endsWith('.har') || base.endsWith('.b64')) return true;
  // Cached data blobs. Source files named precache.* are code and stay allowed.
  if (/^precache/i.test(base) && !/\.(ts|tsx|mjs|js)$/.test(base)) return true;
  return false;
}

function checkPath(p) {
  if (isBlockedPath(p)) fail('R4', p);
  const lower = p.toLowerCase();
  if (banned.some((w) => lower.includes(w))) fail('R5', `${p} (path)`);
}

function checkContent(p, text) {
  const inSynthetic = p.startsWith(SYNTHETIC_DIR);
  if (inSynthetic && p.endsWith('.json')) {
    let ok = false;
    try {
      ok = JSON.parse(text)?._synthetic === true;
    } catch {
      ok = false;
    }
    if (!ok) fail('R1', `${p} (synthetic fixture needs top-level _synthetic: true)`);
  } else if (!inSynthetic && ENTITY_KEY.test(text) && SCORE_KEY.test(text)) {
    fail('R1', `${p} (Qloo-shaped JSON outside synthetic fixtures)`);
  }

  if (text.includes(ANTHROPIC_PREFIX)) fail('R3', `${p} (Anthropic key prefix)`);
  if (secretValues.some((v) => text.includes(v))) fail('R3', `${p} (value from .env.local)`);
  if (path.basename(p) === '.env.example') {
    for (const line of text.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
      if (m && /(API_KEY|TOKEN|SECRET|PRECACHE)/.test(m[1]) && m[2].trim()) {
        fail('R3', `${p} (${m[1]} has a value)`);
      }
    }
  }

  const lower = text.toLowerCase();
  if (banned.some((w) => lower.includes(w))) fail('R5', p);
}

function looksBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

function scanFile(p, buf) {
  checkPath(p);
  if (buf.length > MAX_FILE_BYTES || looksBinary(buf)) return;
  checkContent(p, buf.toString('utf8'));
}

function splitZ(out) {
  return out.split('\0').filter(Boolean);
}

// --- file sets -----------------------------------------------------------

if (modeAll) {
  const files = splitZ(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  for (const p of new Set(files)) {
    const abs = path.join(root, p);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    scanFile(p, readFileSync(abs));
  }
}

if (modeStaged) {
  const files = splitZ(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
  for (const p of files) {
    scanFile(p, git(['show', `:${p}`], { buffer: true }));
  }
}

// --- commit messages and identities (R6) ---------------------------------

function checkMessage(label, message) {
  const body = message
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  if (TRAILER.test(body)) fail('R6', `${label} (tool trailer in commit message)`);
  const lower = body.toLowerCase();
  if (banned.some((w) => lower.includes(w))) fail('R5', `${label} (commit message)`);
}

function checkIdentity(label, ident) {
  const lower = ident.toLowerCase();
  if (banned.some((w) => lower.includes(w))) fail('R6', `${label} (author or committer identity)`);
}

if (commitMsgFile) {
  checkMessage('commit message', readFileSync(commitMsgFile, 'utf8'));
  for (const v of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    try {
      checkIdentity(v.toLowerCase(), git(['var', v]));
    } catch (err) {
      console.error(`R6 could not read ${v}: ${err.message}`);
      process.exit(2);
    }
  }
}

if (withHistory) {
  let log = '';
  try {
    log = git(['log', '--all', '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e']);
  } catch {
    // no commits yet: nothing to scan
  }
  for (const rec of log.split('\x1e')) {
    const [hash, author, committer, message] = rec.trim().split('\x1f');
    if (!hash) continue;
    const label = `commit ${hash.slice(0, 10)}`;
    checkIdentity(label, `${author} ${committer}`);
    checkMessage(label, message ?? '');
  }

  let paths = '';
  let patch = '';
  try {
    paths = git(['log', '--all', '--name-only', '--format=', '-z']);
    patch = git(['log', '--all', '-p', '--format=']);
  } catch {
    // no commits yet
  }
  for (const p of new Set(splitZ(paths).flatMap((s) => s.split('\n')).filter(Boolean))) {
    if (isBlockedPath(p)) fail('R4', `${p} (in history)`);
  }
  if (patch.includes(ANTHROPIC_PREFIX)) fail('R3', 'history (Anthropic key prefix)');
  if (secretValues.some((v) => patch.includes(v))) fail('R3', 'history (value from .env.local)');
  const lowerPatch = patch.toLowerCase();
  if (banned.some((w) => lowerPatch.includes(w))) fail('R5', 'history');
}

// --- result --------------------------------------------------------------

if (failures.length > 0) {
  console.error('check-repo failed:');
  for (const f of new Set(failures)) console.error(`  ${f}`);
  process.exit(1);
}
console.log('check-repo ok');
