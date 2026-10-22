import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import bootstrap from '../index.js';
import { cloudEnvironmentErrors } from './cloud-start.mjs';

const { startSystem } = bootstrap;
const approvedEgress = {
  EGRESS_APPROVED: '1',
  EGRESS_APPROVAL_ENV: 'production',
  EGRESS_APPROVED_BY: 'local-test',
  EGRESS_APPROVAL_REF: 'TEST-109',
  EGRESS_ALLOWED_TARGETS: 'api.telegram.org:443',
};
const stagingHost = 'dpg-stage12345-a.oregon-postgres.render.com';
const stagingConfig = overrides => ({
  NODE_ENV: 'production',
  DEPLOYMENT_ENV: 'staging',
  DATA_ENVIRONMENT: 'staging',
  CLOUD_CUTOVER_APPROVED: '0',
  DATABASE_URL: `postgresql://staging_user@${stagingHost}:5432/ah_sheli_staging`,
  STAGING_DATABASE_HOST: stagingHost,
  STAGING_DATABASE_NAME: 'ah_sheli_staging',
  STAGING_DATABASE_RESOURCE_ID: 'dpg-stage12345',
  STAGING_PUBLIC_APP_URL: 'https://ah-sheli-staging.onrender.com',
  PUBLIC_APP_URL: 'https://ah-sheli-staging.onrender.com',
  SESSION_SECRET: 'synthetic-session-fixture',
  CLERK_AUTH_MODE: 'external',
  CLERK_SECRET_KEY: 'synthetic-clerk-fixture',
  CLERK_PUBLISHABLE_KEY: 'pk_test_fixture',
  GROQ_API_KEY: 'synthetic-ai-fixture',
  TELEGRAM_WORKER_ENABLED: 'false',
  PORT: '5000',
  ...overrides,
});

function runIsolatedStart(env) {
  const script = `
    const { startSystem } = require('./index.js');
    startSystem({
      version: '22.18.0',
      validateEnvironment: () => [],
      loadServer: async () => 'ready',
    }).then(value => process.exit(value === 'ready' ? 0 : 2), () => process.exit(1));
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: new URL('../', import.meta.url),
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('Staging starts with CLOUD_CUTOVER_APPROVED=0 only when egress approval is Staging-scoped', () => {
  const baseEgress = {
    EGRESS_APPROVED: '1',
    EGRESS_APPROVED_BY: 'unit-test',
    EGRESS_APPROVAL_REF: 'TEST-109',
    EGRESS_ALLOWED_TARGETS: `${stagingHost}:5432`,
  };
  const staging = runIsolatedStart({
    ...baseEgress,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'staging',
    EGRESS_APPROVAL_ENV: 'staging',
    CLOUD_CUTOVER_APPROVED: '0',
  });
  assert.equal(staging.status, 0, staging.stderr);

  const wrongCutover = runIsolatedStart({
    ...baseEgress,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'staging',
    EGRESS_APPROVAL_ENV: 'staging',
    CLOUD_CUTOVER_APPROVED: '1',
  });
  assert.equal(wrongCutover.status, 1);

  const production = runIsolatedStart({
    ...baseEgress,
    NODE_ENV: 'production',
    DEPLOYMENT_ENV: 'production',
    EGRESS_APPROVAL_ENV: 'production',
    CLOUD_CUTOVER_APPROVED: '0',
  });
  assert.equal(production.status, 1);
});

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

test('Staging cloud config accepts a verified target, Staging URLs, and a disabled Telegram worker', () => {
  assert.deepEqual(cloudEnvironmentErrors(stagingConfig()), []);
});

test('Staging webhook and Calendar URLs are accepted only on its own HTTPS origin', () => {
  const origin = 'https://ah-sheli-staging.onrender.com';
  const validStagingUrls = cloudEnvironmentErrors(stagingConfig({
    TELEGRAM_WORKER_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'synthetic-telegram-fixture',
    TELEGRAM_WEBHOOK_URL: `${origin}/telegram/webhook`,
    GOOGLE_CALENDAR_REDIRECT_URI: `${origin}/api/mini-app/calendar/callback`,
  }));
  assert.deepEqual(validStagingUrls, []);

  const productionWebhook = cloudEnvironmentErrors(stagingConfig({
    TELEGRAM_WORKER_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'synthetic-telegram-fixture',
    TELEGRAM_WEBHOOK_URL: 'https://yotibot-azbu.onrender.com/telegram/webhook',
  }));
  assert.ok(productionWebhook.some(error => error.includes('Staging origin and webhook path')));

  const productionCalendar = cloudEnvironmentErrors(stagingConfig({
    GOOGLE_CALENDAR_REDIRECT_URI: 'https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback',
  }));
  assert.ok(productionCalendar.some(error => error.includes('verified Staging origin')));
});

test('Staging cloud config rejects Production identities, bad database pins, and unapproved worker activation', () => {
  const badCutover = cloudEnvironmentErrors(stagingConfig({ CLOUD_CUTOVER_APPROVED: '1' }));
  assert.ok(badCutover.some(error => error.includes('CLOUD_CUTOVER_APPROVED')));

  const mismatchedDatabase = cloudEnvironmentErrors(stagingConfig({
    DATABASE_URL: 'postgresql://other-stage.oregon-postgres.render.com/ah_sheli_staging',
  }));
  assert.ok(mismatchedDatabase.some(error => error.includes('database identity')));

  const productionOrigin = cloudEnvironmentErrors(stagingConfig({
    PUBLIC_APP_URL: 'https://yotibot-azbu.onrender.com',
    STAGING_PUBLIC_APP_URL: 'https://yotibot-azbu.onrender.com',
  }));
  assert.ok(productionOrigin.some(error => error.includes('Staging origin')));

  const incompleteWorker = cloudEnvironmentErrors(stagingConfig({
    TELEGRAM_WORKER_ENABLED: 'true',
  }));
  assert.ok(incompleteWorker.includes('TELEGRAM_BOT_TOKEN is required'));
  assert.ok(incompleteWorker.includes('TELEGRAM_WEBHOOK_URL is required'));
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
