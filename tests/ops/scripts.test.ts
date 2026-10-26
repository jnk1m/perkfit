import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const checkRepo = path.join(repoRoot, 'scripts/check-repo.mjs');
const checkBundle = path.join(repoRoot, 'scripts/check-bundle.mjs');

// Violation samples are assembled from parts so this file passes the same checks it tests.
const ENTITY = '"entity' + '_id"';
const ANTHROPIC = 'sk-' + 'ant-api03-xxxxxxxxxxxx';
const BANNED_WORD = 'zzbannedcorp';

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('GIT_')) env[k] = v;
  }
  return { ...env, ...extra };
}

function run(script: string, scriptArgs: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script, ...scriptArgs], { encoding: 'utf8', env: cleanEnv(env) });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('check-repo', () => {
  let dir: string;
  let bannedFile: string;
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], {
      cwd: dir,
      env: cleanEnv(),
      stdio: 'pipe',
    });
  const put = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  };
  const all = (extra: string[] = []) =>
    run(checkRepo, ['--root', dir, '--all', ...extra], { PERKFIT_BANNED_FILE: bannedFile });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'perkfit-repo-'));
    bannedFile = path.join(dir, '..', `${path.basename(dir)}-banned.txt`);
    writeFileSync(bannedFile, `# comment\n${BANNED_WORD}\n`);
    git('init', '-q');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bannedFile, { force: true });
  });

  it('passes a clean tree', () => {
    put('src/a.ts', 'export const a = 1;\n');
    put('tests/fixtures/synthetic/ok.json', JSON.stringify({ _synthetic: true, [ENTITY.replaceAll('"', '')]: 'x' }));
    expect(all().code).toBe(0);
  });

  it('R1 flags Qloo-shaped JSON outside synthetic fixtures', () => {
    put('docs/sample.json', `{ ${ENTITY}: "a", "affinity": 0.5 }`);
    const r = all();
    expect(r.code).toBe(1);
    expect(r.out).toContain('R1 docs/sample.json');
  });

  it('R1 flags a synthetic fixture without the marker', () => {
    put('tests/fixtures/synthetic/bad.json', '{ "results": [] }');
    expect(all().out).toContain('R1 tests/fixtures/synthetic/bad.json');
  });

  it('R3 flags the Anthropic key prefix and .env.local values, without printing them', () => {
    const secret = 'local-secret-value-123456';
    put('.env.local', `QLOO_API_KEY=${secret}\nOTHER=short\n`);
    put('src/leak.ts', `const k = "${secret}";\nconst a = "${ANTHROPIC}";\n`);
    const r = all();
    expect(r.code).toBe(1);
    expect(r.out).toContain('R3 src/leak.ts');
    expect(r.out).not.toContain(secret);
    expect(r.out).not.toContain(ANTHROPIC);
  });

  it('R3 flags a value in .env.example', () => {
    put('.env.example', 'QLOO_API_KEY=something\nQLOO_BASE_URL=https://example.com\n');
    const r = all();
    expect(r.out).toContain('R3 .env.example');
    expect(r.out).toContain('QLOO_API_KEY');
  });

  it('R4 flags blocked paths but allows .env.example and precache source files', () => {
    put('.env.example', 'QLOO_API_KEY=\n');
    put('src/lib/ops/precache.ts', 'export {};\n');
    put('scripts/build-precache.ts', 'export {};\n');
    expect(all().code).toBe(0);
    for (const p of ['probe-raw/x.txt', 'precache.b64', 'data/precache.json', 'secrets/a.txt', 'docs/planning/a.md', 'a.har']) {
      put(p, 'x\n');
    }
    const r = all();
    for (const p of ['probe-raw/x.txt', 'precache.b64', 'data/precache.json', 'secrets/a.txt', 'docs/planning/a.md', 'a.har']) {
      expect(r.out).toContain(`R4 ${p}`);
    }
  });

  it('R5 flags banned words in files without printing the word, and skips when the list is missing', () => {
    put('README.md', `built at ${BANNED_WORD}\n`);
    const r = all();
    expect(r.out).toContain('R5 README.md');
    expect(r.out).not.toContain(BANNED_WORD);
    const skipped = run(checkRepo, ['--root', dir, '--all'], { PERKFIT_BANNED_FILE: path.join(dir, 'missing.txt') });
    expect(skipped.code).toBe(0);
    expect(skipped.out).toContain('R5 skipped');
  });

  it('--staged checks the index', () => {
    put('src/ok.ts', 'export {};\n');
    put('src/leak.ts', `const a = "${ANTHROPIC}";\n`);
    git('add', 'src/ok.ts');
    expect(run(checkRepo, ['--root', dir, '--staged'], { PERKFIT_BANNED_FILE: bannedFile }).code).toBe(0);
    git('add', 'src/leak.ts');
    expect(run(checkRepo, ['--root', dir, '--staged'], { PERKFIT_BANNED_FILE: bannedFile }).out).toContain('R3 src/leak.ts');
  });

  it('R6 flags tool trailers in a commit message file', () => {
    const msg = path.join(dir, 'MSG');
    writeFileSync(msg, 'feat: x\n\nCo-Authored-By: Someone <a@example.com>\n');
    const r = run(checkRepo, ['--root', dir, '--commit-msg', msg], { PERKFIT_BANNED_FILE: bannedFile });
    expect(r.code).toBe(1);
    expect(r.out).toContain('R6');
    writeFileSync(msg, 'feat: x\n\n# Generated with a comment line is ignored\n');
    expect(run(checkRepo, ['--root', dir, '--commit-msg', msg], { PERKFIT_BANNED_FILE: bannedFile }).code).toBe(0);
  });

  it('--history flags trailers and banned author identities in past commits', () => {
    put('a.txt', 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'feat: a', '-m', 'Claude-Session: https://example.com/s');
    const r = all(['--history']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/R6 commit [0-9a-f]{10}/);

    git('commit', '-q', '--amend', '-m', 'feat: a', `--author=Dev <dev@${BANNED_WORD}.example>`);
    const r2 = all(['--history']);
    expect(r2.out).toContain('R6');
    expect(r2.out).not.toContain(BANNED_WORD);
  });

  it('--history flags a secret that was committed and later removed', () => {
    put('src/leak.ts', `const a = "${ANTHROPIC}";\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'feat: leak');
    rmSync(path.join(dir, 'src/leak.ts'));
    git('add', '-A');
    git('commit', '-q', '-m', 'fix: remove');
    expect(all().code).toBe(0);
    expect(all(['--history']).out).toContain('R3 history');
  });
});

describe('check-bundle', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'perkfit-bundle-'));
    mkdirSync(path.join(dir, '.next/static/chunks'), { recursive: true });
    mkdirSync(path.join(dir, '.next/server/app'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const bundle = (env: Record<string, string> = {}) => run(checkBundle, ['--root', dir], env);

  it('passes a clean build', () => {
    writeFileSync(path.join(dir, '.next/static/chunks/a.js'), 'console.log("hello")');
    expect(bundle().code).toBe(0);
  });

  it('fails when the build output is missing', () => {
    rmSync(path.join(dir, '.next'), { recursive: true });
    expect(bundle().code).toBe(2);
  });

  it.each(['QLOO' + '_API_KEY', 'X-Api-' + 'Key', 'hackathon.api.' + 'qloo.com', 'ANTHRO' + 'PIC_API_KEY', 'sk-' + 'ant-abc'])(
    'fails when the client bundle contains %s',
    (needle) => {
      writeFileSync(path.join(dir, '.next/static/chunks/a.js'), `var x="${needle}";`);
      const r = bundle();
      expect(r.code).toBe(1);
      expect(r.out).toContain('.next/static/chunks/a.js');
    },
  );

  it('fails on a forbidden string in prerendered HTML', () => {
    writeFileSync(path.join(dir, '.next/static/chunks/a.js'), 'ok');
    writeFileSync(path.join(dir, '.next/server/app/index.html'), '<p>hackathon.api.' + 'qloo.com</p>');
    expect(bundle().out).toContain('.next/server/app/index.html');
  });

  it('fails when a secret value appears anywhere under .next, without printing the value', () => {
    const value = 'ci-dummy-planted-value-0000';
    writeFileSync(path.join(dir, '.next/static/chunks/a.js'), 'ok');
    writeFileSync(path.join(dir, '.next/server/chunk.js'), `module.exports="${value}"`);
    const r = bundle({ QLOO_API_KEY: value });
    expect(r.code).toBe(1);
    expect(r.out).toContain('.next/server/chunk.js');
    expect(r.out).toContain('QLOO_API_KEY');
    expect(r.out).not.toContain(value);
  });
});
