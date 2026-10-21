import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { telegramChannelOptions } from '../src/lib/channel-onboarding.mjs';

test('public onboarding supports only the requested Telegram bot, with no credential or SQL lookup', () => {
  assert.deepEqual(telegramChannelOptions(), {
    telegram: { available: true, url: 'https://t.me/AhSheli_Reminder_bot' },
  });
});

test('landing page, Mini App and channel controller contain no retired channel or QR integration', async () => {
  for (const file of ['index.html', 'app.html', 'channel-onboarding.js']) {
    const source = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /whatsapp|wa\.me|baileys|qrDataUrl/i, file);
  }
  const source = await readFile(new URL('../public/channel-onboarding.js', import.meta.url), 'utf8');
  assert.match(source, /\['telegram'\]/);
  assert.match(source, /https:\/\/t\.me\/AhSheli_Reminder_bot/);
  assert.match(source, /dataset\.openRegistration/, 'existing signup stays wired');
  assert.match(source, /openTelegramLink/, 'native Mini App handoff stays wired');
});

test('runtime and package manifest no longer mount the retired adapter', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies['whatsapp-web.js'], undefined);
  assert.equal(manifest.dependencies.qrcode, undefined);
  assert.equal(manifest.scripts['whatsapp:console'], undefined);
  const worker = await readFile(new URL('../../ah-sheli-bot/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /whatsapp/i);
  assert.match(worker, /createReminderWorker/);
  assert.match(worker, /\/api\/internal\/mini-app/, 'existing Mini App action bridge remains mounted');
});
