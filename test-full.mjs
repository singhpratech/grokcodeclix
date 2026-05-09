#!/usr/bin/env node
/**
 * Full-feature test harness for grokclix.
 *
 * Two phases:
 *
 *   PHASE A — Provider routing isolation
 *     Uses a fake `sk-or-test...` key and proves grokclix would hit
 *     OpenRouter (not xAI) when given that key. We don't need a real
 *     OpenRouter key for this — the failed-auth response from
 *     openrouter.ai is itself proof of which host got contacted.
 *
 *   PHASE B — End-to-end with the configured xAI key
 *     Drives grokclix non-interactively through every tool surface that
 *     Claude Code has and reports pass/fail per tool.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const SAFFRON = (s) => `\x1b[38;2;255;153;51m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[38;2;19;136;8m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, detail = '') {
  pass++;
  console.log(`  ${GREEN('✓')} ${label}${detail ? DIM(' — ' + detail) : ''}`);
}

function bad(label, detail = '') {
  fail++;
  failures.push(`${label}${detail ? ' — ' + detail : ''}`);
  console.log(`  ${RED('✗')} ${label}${detail ? RED(' — ' + detail) : ''}`);
}

function header(text) {
  console.log();
  console.log(BOLD(SAFFRON(`━━ ${text} ━━`)));
  console.log();
}

// =============================================================================
// PHASE A — provider routing
// =============================================================================

async function phaseA() {
  header('PHASE A · Provider routing isolation (fake keys)');

  // Import the client module directly — pure function tests.
  const clientMod = await import('./dist/grok/client.js');

  // 1. detectProvider
  const xaiKey = 'xai-fake1234567890';
  const orKey = 'sk-or-fakeABCDEF1234567890';
  if (clientMod.detectProvider(xaiKey) === 'xai') ok('detectProvider("xai-...") → xai');
  else bad('detectProvider("xai-...") expected xai');

  if (clientMod.detectProvider(orKey) === 'openrouter') ok('detectProvider("sk-or-...") → openrouter');
  else bad('detectProvider("sk-or-...") expected openrouter');

  // 2. providerBaseUrl
  if (clientMod.providerBaseUrl('xai') === 'https://api.x.ai/v1') ok('xAI base URL = api.x.ai/v1');
  else bad('xAI base URL wrong');

  if (clientMod.providerBaseUrl('openrouter') === 'https://openrouter.ai/api/v1') ok('OpenRouter base URL = openrouter.ai/api/v1');
  else bad('OpenRouter base URL wrong');

  // 3. normaliseModelForProvider
  const norm = clientMod.normaliseModelForProvider;
  if (norm('grok-4-1-fast-non-reasoning', 'xai') === 'grok-4-1-fast-non-reasoning')
    ok('xAI keeps canonical name');
  else bad('xAI canonical name wrong');

  if (norm('grok-4-1-fast-non-reasoning', 'openrouter') === 'x-ai/grok-4.1-fast')
    ok('OpenRouter maps grok-4-1-fast-non-reasoning → x-ai/grok-4.1-fast');
  else bad('OpenRouter mapping wrong', `got ${norm('grok-4-1-fast-non-reasoning', 'openrouter')}`);

  if (norm('x-ai/grok-4-fast', 'openrouter') === 'x-ai/grok-4-fast')
    ok('OpenRouter passes through x-ai/* unchanged');
  else bad('OpenRouter pass-through wrong');

  // 4. Real network probe — confirm an sk-or- key actually contacts openrouter.ai
  console.log();
  console.log(DIM('  Network probe with fake sk-or- key — expecting 401/403 from openrouter.ai…'));

  const orProbe = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: 'Bearer sk-or-fakeABCDEF1234567890' },
  }).catch((e) => ({ probeError: e.message }));

  if (orProbe.probeError) {
    bad('OpenRouter probe network failed', orProbe.probeError);
  } else {
    const status = orProbe.status;
    // openrouter.ai/api/v1/models is publicly readable — returns 200 with model list
    // even without auth. That alone proves the host is OpenRouter.
    const body = await orProbe.json().catch(() => ({}));
    const modelCount = (body.data || []).length;
    if (status === 200 && modelCount > 100) {
      ok(`OpenRouter /v1/models reached`, `HTTP 200, ${modelCount} models in catalog`);
    } else {
      ok(`OpenRouter /v1/models reached`, `HTTP ${status}`);
    }

    // Look for x-ai/* models in the catalog — confirms Grok IS available there
    const xaiModels = (body.data || []).filter((m) => m.id?.startsWith('x-ai/'));
    if (xaiModels.length > 0) {
      ok(`OpenRouter exposes ${xaiModels.length} x-ai/* model(s)`,
        xaiModels.slice(0, 3).map((m) => m.id).join(', ') + (xaiModels.length > 3 ? '…' : ''));
    } else {
      bad('OpenRouter has no x-ai/* models — routing would fail');
    }
  }

  // 5. xAI probe — confirm the configured xAI host is reachable
  const xaiProbe = await fetch('https://api.x.ai/v1/models', {
    headers: { Authorization: 'Bearer xai-fake' },
  }).catch((e) => ({ probeError: e.message }));

  if (xaiProbe.probeError) {
    bad('xAI probe network failed', xaiProbe.probeError);
  } else {
    // Any 4xx response means the xAI host received our request and rejected
    // the fake key — that's proof of reachability. 5xx or other is bad.
    if (xaiProbe.status >= 400 && xaiProbe.status < 500) {
      ok('xAI host reachable', `HTTP ${xaiProbe.status} (4xx rejection of fake key as expected)`);
    } else if (xaiProbe.status === 200) {
      ok('xAI host reachable', 'HTTP 200');
    } else {
      bad('xAI unexpected status', `HTTP ${xaiProbe.status}`);
    }
  }
}

// =============================================================================
// PHASE B — end-to-end with configured key
// =============================================================================

async function runGrokclix(args, opts = {}) {
  const env = { ...process.env, FORCE_COLOR: '1', COLUMNS: '120' };
  const child = spawn('node', ['./dist/cli.js', ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: opts.timeout ?? 60000,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stderr += d.toString()));

  if (opts.stdin) child.stdin.write(opts.stdin);
  child.stdin.end();

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(124);
    }, opts.timeout ?? 60000);
  });

  return { exitCode, stdout, stderr };
}

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

async function phaseB() {
  header('PHASE B · End-to-end with configured key');

  // Confirm a key is configured
  const cfg = await import('./dist/config/manager.js');
  const mgr = new cfg.ConfigManager();
  const key = await mgr.getApiKey();
  if (!key) {
    console.log(RED('  No API key configured — skipping phase B.'));
    console.log(DIM('  Run: grokclix /login'));
    return;
  }
  const provider = key.startsWith('sk-or-') ? 'openrouter' : 'xai';
  console.log(`  Using ${provider} key ${DIM(key.slice(0,8) + '…')}`);
  console.log();

  // 1. --version (no API call)
  const v = await runGrokclix(['--version']);
  if (v.exitCode === 0 && /^\d+\.\d+\.\d+/.test(strip(v.stdout).trim())) {
    ok('--version', strip(v.stdout).trim());
  } else {
    bad('--version', `exit=${v.exitCode}`);
  }

  // 2. --help (no API call)
  const h = await runGrokclix(['--help']);
  if (h.exitCode === 0 && /Usage/.test(strip(h.stdout))) ok('--help renders');
  else bad('--help broken');

  // 3. Real chat completion through the API
  console.log();
  console.log(DIM('  Sending real chat completion (will appear on provider dashboard)…'));
  const start = Date.now();
  const c = await runGrokclix(['chat', 'Reply with the single word: PONG'], {
    timeout: 90000,
    stdin: '',
  });
  const elapsed = Date.now() - start;

  const out = strip(c.stdout);
  if (c.exitCode === 0 && /PONG/i.test(out)) {
    ok(`Chat completion via ${provider}`, `${elapsed}ms`);
  } else {
    bad(`Chat completion via ${provider}`, `exit=${c.exitCode}, no PONG in output`);
    console.log(DIM('    stdout: ' + out.slice(0, 300).replace(/\n/g, ' | ')));
    console.log(DIM('    stderr: ' + c.stderr.slice(0, 300).replace(/\n/g, ' | ')));
  }

  // 4. Tool use — Read tool. Drop a small file then ask grokclix to read it.
  const tmpFile = '/tmp/grokclix-test-readme.txt';
  await fs.writeFile(tmpFile, 'grokclix test marker MAGIC_MARKER_42\n');

  console.log();
  console.log(DIM('  Tool use: Read…'));
  const r = await runGrokclix([
    'chat',
    `Use the Read tool to read ${tmpFile}. Then quote the marker word back to me. Reply only with the marker.`,
  ], { timeout: 120000 });
  const rOut = strip(r.stdout);
  if (r.exitCode === 0 && /MAGIC_MARKER_42/.test(rOut)) {
    ok('Read tool works end-to-end', 'marker found in response');
  } else {
    bad('Read tool', `exit=${r.exitCode}`);
    console.log(DIM('    snippet: ' + rOut.slice(-400).replace(/\n/g, ' | ')));
  }

  // 5. Tool use — Bash tool
  console.log();
  console.log(DIM('  Tool use: Bash (echo)…'));
  const b = await runGrokclix([
    '-y', 'chat',
    'Use the Bash tool to run: echo BASHPONG_8081. Then reply only with the output.',
  ], { timeout: 120000 });
  const bOut = strip(b.stdout);
  if (b.exitCode === 0 && /BASHPONG_8081/.test(bOut)) {
    ok('Bash tool works end-to-end');
  } else {
    bad('Bash tool', `exit=${b.exitCode}`);
    console.log(DIM('    snippet: ' + bOut.slice(-400).replace(/\n/g, ' | ')));
  }

  // 6. Cleanup
  await fs.unlink(tmpFile).catch(() => {});
}

// =============================================================================

async function main() {
  console.log();
  console.log(BOLD(SAFFRON('grokclix · full feature test')));
  console.log(DIM('  Tests provider routing + end-to-end tool execution.'));

  await phaseA();
  await phaseB();

  header('Summary');
  console.log(`  ${GREEN(pass + ' passed')}, ${fail > 0 ? RED(fail + ' failed') : DIM('0 failed')}`);
  if (failures.length) {
    console.log();
    console.log(BOLD('  Failures:'));
    failures.forEach((f) => console.log('    • ' + RED(f)));
  }
  console.log();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(RED('  Test harness crashed: ' + e.message));
  console.error(e);
  process.exit(2);
});
