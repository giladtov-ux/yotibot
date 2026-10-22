import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import bootstrap from '../index.js';

const { startSystem } = bootstrap;
const approvedEgress = {
  EGRESS_APPROVED: '1',
  EGRESS_APPROVAL_ENV: 'production',
  EGRESS_APPROVED_BY: 'local-test',
  EGRESS_APPROVAL_REF: 'TEST-109',
  EGRESS_ALLOWED_TARGETS: 'api.telegram.org:443',
};

test('root startup imports the complete API once and awaits initialization', async () => {
  let calls = 0;
  let release;
  const loading = new Promise(resolve => { release = resolve; });
  let settled = false;
  const started = startSystem({
    version: '22.18.0',
    env: { ...approvedEgress, NODE_ENV: 'production', CLOUD_CUTOVER_APPROVED: '1' },
    validateEnvironment: () => [],
    loadServer: () => { calls++; return loading; },
  }).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(settled, false);
  release('initialized');
  assert.equal(await started, 'initialized');
});

test('unsupported Node version is rejected before loading a worker', async () => {
  for (const version of ['20.19.0', '22.17.1', 'invalid']) {
    let called = false;
    await assert.rejects(startSystem({
      version, env: {}, loadServer: () => { called = true; },
    }), /22\.18/);
    assert.equal(called, false);
  }
});

test('unapproved production startup cannot initialize or register a bot', async () => {
  let called = false;
  await assert.rejects(startSystem({
    version: '24.0.0', env: { ...approvedEgress, NODE_ENV: 'production' },
    loadServer: () => { called = true; },
  }), /approve the production cutover/);
  assert.equal(called, false);
});

test('worker initialization failure is not converted into a successful startup', async () => {
  const failure = new Error('synthetic initialization failure');
  await assert.rejects(startSystem({
    version: '22.18.0',
    env: { ...approvedEgress, NODE_ENV: 'production', CLOUD_CUTOVER_APPROVED: '1' },
    validateEnvironment: () => [],
    loadServer: async () => { throw failure; },
  }), error => error === failure);
});

test('root entry targets the complete API, not an independent worker or test server', () => {
  const entry = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(entry, /import\('\.\/artifacts\/api-server\/dist\/index\.mjs'\)/);
  assert.doesNotMatch(entry, /import\('\.\/artifacts\/ah-sheli-bot\/index\.js'\)/);
  assert.doesNotMatch(entry, /createServer|Yotibot is running!/);
  assert.doesNotMatch(entry, /setWebhook|drop_pending_updates/);
});

test('node index.js from repository root rejects unapproved startup without secrets', () => {
  const child = spawnSync(process.execPath, ['index.js'], {
    cwd: new URL('../', import.meta.url),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      CLOUD_CUTOVER_APPROVED: '0',
      AH_SHELI_DATA_DIR: '/tmp/ah-sheli-isolated-root-cli-test',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /egress authorization/iu);
  assert.doesNotMatch(child.stderr, /Yotibot is running!/);
});
