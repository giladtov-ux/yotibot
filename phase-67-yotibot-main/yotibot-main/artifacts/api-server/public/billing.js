(() => {
  'use strict';

  const publicDirectory = new URL('.', document.baseURI);
  const endpoint = (path) => new URL(`api/${path}`, publicDirectory).toString();
  const dialog = document.getElementById('billing-dialog');
  const formView = document.getElementById('billing-form-view');
  const statusView = document.getElementById('billing-status-view');
  const form = document.getElementById('billing-registration-form');
  const alertBox = document.getElementById('billing-alert');
  const live = document.getElementById('billing-live');
  const formSubmit = document.getElementById('billing-register-submit');
  const checkoutButton = document.getElementById('billing-checkout');
  const portalLink = document.getElementById('billing-portal');
  const retryButton = document.getElementById('billing-retry');
  const telegramLink = document.getElementById('billing-telegram-link');
  const botLink = document.getElementById('billing-bot-link');
  const codeForm = document.getElementById('billing-code-form');
  const codeInput = document.getElementById('billing-verification-code');
  const codeError = document.getElementById('billing-code-error');
  const verifySubmit = document.getElementById('billing-verify-submit');
  const codeLoading = document.getElementById('billing-code-loading');
  const planNames = ['Basic', 'Pro', 'Unlimited'];
  const monthlyPrices = { Pro: '₪29 כל 30 יום', Unlimited: '₪79 כל 30 יום' };
  const returnState = new URL(window.location.href).searchParams.get('billing');
  let chosenPlan = 'Basic';
  let currentRegistration = null;
  let pollTimer = null;
  let pollRun = 0;
  let pollCount = 0;
  let busy = false;

  function translateError(code, fallback) {
    const messages = {
      invalid_telegram_id: 'מזהה Telegram לא תקין. בדקו את המספר שהבוט החזיר.',
      invalid_phone: 'מספר הטלפון לא תקין. בדקו את הספרות ונסו שוב.',
      invalid_email: 'כתובת הדוא״ל לא תקינה. בדקו אותה או השאירו את השדה ריק.',
      invalid_code: 'הקוד לא תקין. בדקו את 8 הספרות שהבוט שלח ונסו שוב.',
      invalid_verification_code: 'הקוד לא תקין. בדקו את 8 הספרות שהבוט שלח ונסו שוב.',
      invalid_plan_tier: 'לא הצלחנו לזהות את התוכנית. בחרו תוכנית ונסו שוב.',
      registration_exists: 'כבר קיימת הרשמה בחשבון הזה. בדקו את מצב ההרשמה.',
      telegram_id_in_use: 'מזהה Telegram הזה כבר משויך לחשבון אחר.',
      checkout_unavailable: 'אפשר לעבור לתשלום רק אחרי אימות החשבון ב־Telegram.',
      billing_unavailable: 'ניהול המינוי עדיין לא זמין עבור החשבון הזה.',
      not_found: 'לא נמצאה הרשמה פעילה. אפשר להתחיל הרשמה חדשה.',
      rate_limited: 'נשלחו יותר מדי בקשות בזמן קצר. המתינו מעט ונסו שוב.',
      network_error: 'לא הצלחנו להתחבר לשרת. בדקו את החיבור ונסו שוב.',
      request_timeout: 'הבקשה ארכה יותר מדי. אפשר לנסות שוב.'
    };
    if (code && messages[code]) return messages[code];
    return fallback || 'אירעה תקלה. נסו שוב בעוד רגע.';
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(endpoint(path), {
        ...options,
        credentials: 'same-origin',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(window.AhSheliMiniApp && window.AhSheliMiniApp.active ? { 'X-Ah-Sheli-Mini-App': '1' } : {}),
          ...options.headers,
        },
        signal: controller.signal
      });
      let body = null;
      try { body = await response.json(); } catch (_) { body = null; }
      if (!response.ok) {
        const error = new Error(translateError(body && body.error, body && body.message));
        error.status = response.status;
        error.code = body && body.error;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(translateError('request_timeout'));
      if (error instanceof TypeError) throw new Error(translateError('network_error'));
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.hidden = !message;
  }

  function setBusy(value, label) {
    busy = value;
    [formSubmit, checkoutButton, retryButton].forEach((button) => {
      if (button) button.disabled = value;
    });
    if (formSubmit) formSubmit.textContent = value && label ? label : 'המשך לאימות ב־Telegram';
    if (checkoutButton) checkoutButton.textContent = value && label ? label : currentRegistration && currentRegistration.state === 'checkout_pending' ? 'חזרה לתשלום ב־Whop' : 'המשך לתשלום מאובטח ב־Whop';
    live.textContent = value ? (label || 'טוענים את פרטי ההרשמה…') : '';
  }

  function updatePlan(plan) {
    chosenPlan = planNames.includes(plan) ? plan : 'Basic';
    document.getElementById('billing-selected-plan').textContent = chosenPlan;
    document.getElementById('billing-plan-picker').value = chosenPlan;
    const consentWrap = document.getElementById('billing-consent-wrap');
    const price = monthlyPrices[chosenPlan];
    consentWrap.hidden = true;
    document.getElementById('billing-consent-price').textContent = price || '';
    document.getElementById('billing-status-price').textContent = price || '';
    document.getElementById('billing-recurring-consent').checked = false;
    document.getElementById('billing-status-consent').checked = false;
  }

  function setFormMode() {
    formView.hidden = false;
    statusView.hidden = true;
    document.getElementById('billing-plan-picker-wrap').hidden = true;
    document.getElementById('billing-test-mode').hidden = true;
    codeForm.hidden = true;
    codeError.hidden = true;
    codeError.textContent = '';
    codeInput.value = '';
    codeInput.setAttribute('aria-invalid', 'false');
    botLink.hidden = true;
    currentRegistration = null;
    showAlert('');
    stopPolling();
  }

  function setStatusMode() {
    formView.hidden = true;
    statusView.hidden = false;
    showAlert('');
  }

  function stopPolling() {
    pollRun += 1;
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function isPollingState(state) {
    return ['awaiting_telegram', 'pending_approval', 'checkout_pending'].includes(state);
  }

  function stateCopy(registration) {
    const expiry = registration.expires_at ? new Date(registration.expires_at) : null;
    const expiryText = expiry && !Number.isNaN(expiry.getTime())
      ? ` תוקף ההרשמה עד ${expiry.toLocaleDateString('he-IL')}.`
      : '';
    const access = registration.access_status ? ` מצב גישה: ${registration.access_status}.` : '';
    const copy = {
      awaiting_telegram: ['ממתינים לאימות ב־Telegram', 'פתחו את קישור הבוט ולחצו על התחלה כדי לקבל קוד אימות אישי.'],
      pending_approval: ['ההרשמה ממתינה לאישור', 'הפרטים התקבלו. בתוכנית Basic נדרש אישור ידני של מנהל העוזר. נעדכן את המצב כשהאישור יתקבל.'],
      ready_for_checkout: ['החשבון אומת', registration.plan_tier === 'Basic' ? 'החשבון מוכן, והתוכנית החינמית ממתינה לאישור ידני.' : 'אפשר להמשיך עכשיו לעמוד התשלום המאובטח.'],
      checkout_pending: ['התשלום עדיין לא אושר', 'אפשר לחזור לאותו תהליך תשלום מאובטח. השרת משתמש בתהליך הקיים, ומצב המינוי נקבע לפי תשובת השרת.'],
      active: ['המינוי פעיל', 'הגישה אושרה. אפשר להתחיל להשתמש בעוזר האישי ב־Telegram.'],
      expired: ['ההרשמה הסתיימה', 'אפשר להתחיל מחדש ולבחור תוכנית.']
    };
    const found = copy[registration.state] || ['מצב ההרשמה', 'קיבלנו את מצב ההרשמה מהשרת.'];
    return [found[0], `${found[1]}${expiryText}${access}`];
  }

  function safeExternalUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      const allowed = url.hostname === 't.me' || url.hostname === 'whop.com' || url.hostname.endsWith('.whop.com');
      return url.protocol === 'https:' && !url.username && !url.password && allowed ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function renderRegistration(registration, fromPoll = false) {
    if (!registration || typeof registration.state !== 'string') {
      throw new Error('לא התקבל מצב הרשמה תקין מהשרת. נסו לבדוק שוב.');
    }
    currentRegistration = registration;
    if (planNames.includes(registration.plan_tier)) updatePlan(registration.plan_tier);
    setStatusMode();

    const [title, stateDescription] = stateCopy(registration);
    let copy = stateDescription;
    if (returnState === 'cancel') copy += ' התשלום לא הושלם. אפשר לחזור לתשלום המאובטח; מצב המינוי מוצג לפי תשובת השרת.';
    if (returnState === 'success') copy += ' חזרתם מתהליך התשלום. מצב המינוי מוצג לפי תשובת השרת בלבד.';
    if (registration.state === 'awaiting_telegram' && !safeExternalUrl(registration.telegram_url)) {
      copy = 'קישור האימות פג תוקף או אינו זמין. התחילו הרשמה מחדש באמצעות הכפתור למטה כדי לקבל קישור חדש.';
    } else if (registration.state === 'awaiting_telegram' && registration.code_sent === true) {
      copy = 'הבוט שלח קוד אימות בן 8 ספרות. הזינו אותו כאן כדי לאמת את החשבון. קישור הבוט נשאר זמין לקבלת קוד חדש אם צריך.';
    } else if (registration.state === 'awaiting_telegram') {
      copy = 'פתחו את קישור הבוט ולחצו על התחלה. הבוט ישלח קוד אימות בן 8 ספרות. אם הקוד פג אחרי 10 דקות או הוזן שגוי 5 פעמים, פתחו שוב את הקישור לקבלת קוד חדש.';
    }
    document.getElementById('billing-status-title').textContent = title;
    document.getElementById('billing-status-copy').textContent = copy;
    const statusMark = document.getElementById('billing-status-mark');
    statusMark.classList.toggle('is-active', registration.state === 'active');
    statusMark.classList.toggle('is-pending', isPollingState(registration.state));

    const botUrl = safeExternalUrl(registration.telegram_url);
    botLink.hidden = !botUrl;
    telegramLink.hidden = !botUrl || registration.state !== 'awaiting_telegram';
    if (botUrl) {
      botLink.href = botUrl;
      telegramLink.href = botUrl;
    } else {
      botLink.removeAttribute('href');
      telegramLink.removeAttribute('href');
    }
    document.getElementById('billing-telegram-instructions').hidden = registration.state !== 'awaiting_telegram' || !botUrl;
    codeForm.hidden = registration.state !== 'awaiting_telegram' || registration.code_sent !== true;

    const canCheckout = ['ready_for_checkout', 'checkout_pending'].includes(registration.state)
      && registration.billing_available === true
      && registration.plan_tier !== 'Basic';
    const needsConsent = canCheckout;
    document.getElementById('billing-status-consent-wrap').hidden = !needsConsent;
    checkoutButton.hidden = !canCheckout;
    checkoutButton.textContent = registration.state === 'checkout_pending' ? 'חזרה לתשלום ב־Whop' : 'המשך לתשלום מאובטח ב־Whop';
    document.getElementById('billing-test-mode').hidden = !canCheckout || registration.payment_mode !== 'test';
    portalLink.hidden = !(registration.has_customer === true && registration.billing_available === true);
    retryButton.hidden = true;
    document.getElementById('billing-restart').hidden = false;
    document.getElementById('billing-restart').textContent =
      registration.state === 'awaiting_telegram' && !botUrl
        ? 'הרשמה מחדש וקבלת קישור חדש'
        : registration.state === 'active'
          ? 'התחלה עם תוכנית אחרת'
          : 'בחירת תוכנית אחרת או התחלה מחדש';
    if (isPollingState(registration.state)) {
      if (fromPoll) schedulePoll(pollRun);
      else beginPolling();
    } else {
      stopPolling();
    }
  }

  function showLookupError(error) {
    setStatusMode();
    document.getElementById('billing-status-title').textContent = 'לא הצלחנו לבדוק את ההרשמה';
    document.getElementById('billing-status-copy').textContent = error.message || translateError();
    document.getElementById('billing-status-mark').classList.remove('is-active', 'is-pending');
    telegramLink.hidden = true;
    codeForm.hidden = true;
    codeError.hidden = true;
    document.getElementById('billing-telegram-instructions').hidden = true;
    checkoutButton.hidden = true;
    document.getElementById('billing-test-mode').hidden = true;
    portalLink.hidden = true;
    document.getElementById('billing-status-consent-wrap').hidden = true;
    document.getElementById('billing-restart').hidden = true;
    retryButton.hidden = false;
    stopPolling();
  }

  async function fetchRegistration() {
    try {
      const registration = await request('registration', { method: 'GET' });
      renderRegistration(registration);
      return true;
    } catch (error) {
      if (error.status === 404) {
        setFormMode();
        return false;
      }
      throw error;
    }
  }

  function beginPolling() {
    stopPolling();
    pollCount = 0;
    const run = pollRun;
    schedulePoll(run);
  }

  function schedulePoll(run) {
    if (run !== pollRun || !dialog.open || document.hidden || !currentRegistration || !isPollingState(currentRegistration.state)) return;
    if (pollCount >= 40) {
      retryButton.hidden = false;
      live.textContent = 'הבדיקה האוטומטית נעצרה. אפשר לבדוק שוב באופן ידני.';
      return;
    }
    pollTimer = window.setTimeout(async () => {
      pollTimer = null;
      if (run !== pollRun || !dialog.open || document.hidden) return;
      pollCount += 1;
      try {
        const registration = await request('registration', { method: 'GET' });
        if (run !== pollRun || !dialog.open) return;
        renderRegistration(registration, true);
      } catch (error) {
        if (run !== pollRun || !dialog.open) return;
        if (error.status === 404) {
          setFormMode();
          showAlert('לא נמצאה הרשמה פעילה. אפשר להתחיל הרשמה חדשה.');
          return;
        }
        showLookupError(error);
      }
    }, 2500);
  }

  async function showCurrentRegistration() {
    stopPolling();
    showAlert('');
    retryButton.hidden = true;
    setBusy(true, 'בודקים את מצב ההרשמה…');
    try {
      const found = await fetchRegistration();
      if (!found) setFormMode();
    } catch (error) {
      showLookupError(error);
    } finally {
      setBusy(false);
    }
  }

  function openDialog(plan) {
    updatePlan(plan || chosenPlan);
    if (!dialog.open) dialog.showModal();
    return showCurrentRegistration();
  }

  function openWithPlan(plan) {
    openDialog(plan);
  }

  document.querySelectorAll('[data-open-registration]').forEach((button) => {
    button.addEventListener('click', () => openWithPlan(button.dataset.plan));
  });
  document.querySelectorAll('[data-close-registration]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    stopPolling();
    codeInput.value = '';
    codeInput.setAttribute('aria-invalid', 'false');
    codeError.textContent = '';
    codeError.hidden = true;
    codeLoading.textContent = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (!dialog.open || document.hidden || !currentRegistration || !isPollingState(currentRegistration.state) || pollTimer !== null) return;
    schedulePoll(pollRun);
  });

  document.getElementById('billing-change-plan').addEventListener('click', () => {
    const pickerWrap = document.getElementById('billing-plan-picker-wrap');
    pickerWrap.hidden = !pickerWrap.hidden;
    if (!pickerWrap.hidden) document.getElementById('billing-plan-picker').focus();
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 8);
    codeInput.setAttribute('aria-invalid', 'false');
    codeError.textContent = '';
    codeError.hidden = true;
  });

  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim();
    codeError.textContent = '';
    codeError.hidden = true;
    codeInput.setAttribute('aria-invalid', 'false');
    if (!/^[0-9]{8}$/.test(code)) {
      codeInput.setAttribute('aria-invalid', 'true');
      codeError.textContent = 'יש להזין את קוד האימות בן 8 הספרות שקיבלתם בבוט.';
      codeError.hidden = false;
      codeInput.focus();
      return;
    }
    if (busy) return;
    stopPolling();
    verifySubmit.disabled = true;
    verifySubmit.textContent = 'מאמתים את הקוד…';
    codeLoading.textContent = 'בודקים את הקוד מול השרת…';
    const body = JSON.stringify({ code });
    codeInput.value = '';
    try {
      const registration = await request('registration/verify', { method: 'POST', body });
      codeError.hidden = true;
      codeError.textContent = '';
      codeInput.setAttribute('aria-invalid', 'false');
      renderRegistration(registration);
    } catch (error) {
      codeInput.setAttribute('aria-invalid', 'true');
      if (error.status === 423) {
        codeError.textContent = 'הקוד פג תוקף או שמספר הניסיונות המרבי הושג. פתחו מחדש את קישור הבוט למעלה כדי לקבל קוד חדש.';
      } else if (error.status === 400) {
        codeError.textContent = 'הקוד שגוי או אינו תקין. בדקו את 8 הספרות שקיבלתם בבוט ונסו שוב.';
      } else {
        codeError.textContent = error.message || 'לא הצלחנו לאמת את הקוד. נסו שוב.';
      }
      codeError.hidden = false;
      try {
        const latest = await request('registration', { method: 'GET' });
        renderRegistration(latest);
      } catch (_) {
        if (currentRegistration && isPollingState(currentRegistration.state)) beginPolling();
      }
    } finally {
      verifySubmit.disabled = false;
      verifySubmit.textContent = 'אימות הקוד';
      codeLoading.textContent = '';
    }
  });

  document.getElementById('billing-plan-picker').addEventListener('change', async (event) => {
    const nextPlan = event.target.value;
    if (!planNames.includes(nextPlan)) return;
    setBusy(true, 'מכינים הרשמה מחדש…');
    try {
      await request('registration/reset', { method: 'POST', body: '{}' });
      updatePlan(nextPlan);
      form.reset();
      setFormMode();
      document.getElementById('billing-registration-form').elements.telegram_id.focus();
    } catch (error) {
      showAlert(error.message || translateError());
    } finally {
      setBusy(false);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showAlert('');
    const fields = form.elements;
    const telegramId = fields.telegram_id.value.trim();
    const name = fields.name.value.trim();
    const phone = fields.phone.value.trim();
    const email = fields.email.value.trim();
    const invalid = (input, message) => {
      input.setAttribute('aria-invalid', 'true');
      showAlert(message);
      input.focus();
    };
    form.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
    if (!/^[0-9]+$/.test(telegramId) || !/[1-9]/.test(telegramId)) {
      invalid(fields.telegram_id, 'יש להזין מזהה Telegram חיובי, בספרות בלבד. שלחו ‎/id לבוט כדי למצוא אותו.');
      return;
    }
    if (!name) { invalid(fields.name, 'נא למלא שם.'); return; }
    if (!phone || phone.replace(/\D/g, '').length < 7) { invalid(fields.phone, 'נא להזין מספר טלפון תקין.'); return; }
    if (email && !fields.email.validity.valid) { invalid(fields.email, 'כתובת הדוא״ל אינה תקינה.'); return; }
    setBusy(true, 'שולחים את פרטי ההרשמה…');
    try {
      await request('register-user', {
        method: 'POST',
        body: JSON.stringify({ telegram_id: telegramId, phone, name, email, plan_tier: chosenPlan })
      });
      live.textContent = 'ההרשמה התקבלה. בודקים את המצב מול השרת…';
      const registration = await request('registration', { method: 'GET' });
      renderRegistration(registration);
    } catch (error) {
      showAlert(error.message || translateError());
      if (error.status === 404) showAlert('ההרשמה התקבלה, אך לא הצלחנו למצוא את המצב שלה. בדקו שוב בעוד רגע.');
    } finally {
      setBusy(false);
    }
  });

  checkoutButton.addEventListener('click', async () => {
    if (busy || !currentRegistration || !['ready_for_checkout', 'checkout_pending'].includes(currentRegistration.state) || currentRegistration.plan_tier === 'Basic') return;
    if (!document.getElementById('billing-status-consent').checked) {
      showAlert('לפני המעבר לתשלום, יש לאשר את החיוב החודשי החוזר.');
      document.getElementById('billing-status-consent').focus();
      return;
    }
    showAlert('');
    setBusy(true, 'פותחים תשלום מאובטח…');
    try {
      const result = await request('checkout', { method: 'POST', body: '{}' });
      const url = safeExternalUrl(result && result.url);
      if (!url) throw new Error('לא התקבל קישור תשלום תקין. נסו שוב.');
      if (!window.AhSheliMiniApp) window.location.assign(url);
      else if (window.AhSheliMiniApp.openExternal(url)) {
        setBusy(false);
        await showCurrentRegistration();
      }
    } catch (error) {
      showAlert(error.message || translateError());
      if (currentRegistration && ['ready_for_checkout', 'checkout_pending'].includes(currentRegistration.state)) checkoutButton.hidden = false;
      setBusy(false);
    }
  });

  portalLink.addEventListener('click', async (event) => {
    event.preventDefault();
    if (busy || !currentRegistration || !currentRegistration.has_customer || !currentRegistration.billing_available) return;
    showAlert('');
    setBusy(true, 'פותחים את ניהול המינוי…');
    try {
      const result = await request('billing/portal', { method: 'POST', body: '{}' });
      const url = safeExternalUrl(result && result.url);
      if (!url) throw new Error('לא התקבל קישור לניהול המינוי. נסו שוב.');
      if (!window.AhSheliMiniApp) window.location.assign(url);
      else if (window.AhSheliMiniApp.openExternal(url)) setBusy(false);
    } catch (error) {
      showAlert(error.message || translateError());
      setBusy(false);
    }
  });

  retryButton.addEventListener('click', async () => {
    retryButton.hidden = true;
    await showCurrentRegistration();
  });

  document.getElementById('billing-restart').addEventListener('click', async () => {
    setBusy(true, 'מכינים הרשמה חדשה…');
    try {
      await request('registration/reset', { method: 'POST', body: '{}' });
      form.reset();
      setFormMode();
      document.getElementById('billing-plan-picker-wrap').hidden = false;
      document.getElementById('billing-plan-picker').value = chosenPlan;
      document.getElementById('billing-registration-form').elements.telegram_id.focus();
      live.textContent = 'אפשר לבחור תוכנית אחרת ולהתחיל מחדש.';
    } catch (error) {
      showAlert(error.message || translateError());
    } finally {
      setBusy(false);
    }
  });

  if (returnState === 'success' || returnState === 'cancel') {
    openDialog('Basic').then(() => {
      if (returnState === 'cancel' && !currentRegistration) {
        showAlert('התשלום לא הושלם. לא נמצאה הרשמה פעילה שניתן לחדש ממנה את התשלום.');
      }
    });
  }
})();
