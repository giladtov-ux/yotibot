import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const billing = readFileSync(new URL('../public/billing.js', import.meta.url), 'utf8');

test('public home contains the main, support, dashboard preview and account registration surfaces', () => {
  assert.match(html, /<html lang="he" dir="rtl">/);
  for (const id of [
    'main-content', 'tab-features', 'tab-pricing', 'preview', 'support',
    'personal-area', 'billing-dialog', 'billing-registration-form',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /href="\/sign-up"/);
  assert.match(html, /href="\/sign-in"/);
  assert.match(html, /תצוגת דמו/);
  assert.doesNotMatch(html, /id="personal-email-form"/);
});

test('registration email is optional and is sent only by explicit registration submission', () => {
  const form = html.match(/<form id="billing-registration-form"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'the real registration form must be present');
  assert.match(form, /<input name="email" type="email"/);
  assert.match(form, /field-optional">לא חובה/);
  assert.doesNotMatch(`${html}\n${billing}`, /\b(?:localStorage|sessionStorage)\b/);

  const submitHandler = billing.match(
    /form\.addEventListener\('submit', async \(event\) => \{[\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(submitHandler, 'registration must have an explicit submit handler');
  assert.match(submitHandler, /const email = fields\.email\.value\.trim\(\)/);
  assert.match(submitHandler, /request\('register-user', \{\s*method: 'POST'/);
  assert.match(submitHandler, /JSON\.stringify\(\{[^}]*email[^}]*\}\)/);
});

test('pricing selection remains a local illustration, not a payment operation', () => {
  const source = html.match(/function choosePlan\(plan\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source);
  const status = { textContent: '', scrollIntoView: () => {} };
  const context = {
    document: { getElementById: id => {
      if (id === 'selected-plan') return status;
      if (id === 'personal-area') return { scrollIntoView: () => {} };
      throw new Error(`Unexpected field: ${id}`);
    } },
    window: { matchMedia: () => ({ matches: true }) },
    fetch: () => { throw new Error('Preview price selection must not start checkout'); },
  };
  vm.runInNewContext(source + '\nchoosePlan("Basic");', context, { timeout: 500 });
  assert.match(status.textContent, /להמחשה בלבד/);
  assert.match(status.textContent, /לא בוצעה רכישה/);
});
