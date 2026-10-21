import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('public home contains the main, support and explicitly preview-only email surfaces', () => {
  assert.match(html, /<html lang="he" dir="rtl">/);
  for (const id of ['main-content', 'tab-features', 'tab-pricing', 'preview', 'support', 'personal-email-form']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /type="email"/);
  assert.match(html, /תצוגה בלבד/);
});

test('email preview submit prevents navigation and never accesses network or storage', () => {
  const source = html.match(
    /document\.getElementById\('personal-email-form'\)\.addEventListener\('submit',[\s\S]*?\n    \}\);/,
  )?.[0];
  assert.ok(source, 'the preview submit handler must remain present');
  let handler;
  let prevented = false;
  const feedback = { textContent: '' };
  const forbidden = () => { throw new Error('Preview must not send or persist user information'); };
  const context = {
    document: { getElementById: id => {
      if (id === 'personal-email-form') return { addEventListener: (_, callback) => { handler = callback; } };
      if (id === 'email-feedback') return feedback;
      throw new Error(`Unexpected field: ${id}`);
    } },
    fetch: forbidden, XMLHttpRequest: forbidden,
    localStorage: { setItem: forbidden }, sessionStorage: { setItem: forbidden },
  };
  vm.runInNewContext(source, context, { timeout: 500 });
  handler({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(feedback.textContent, /לא התחברתם/);
  assert.match(feedback.textContent, /לא נשמר או נשלח/);
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
