# Phase 118 — תיקון חסמי Staging במצב Fail-Closed

## סטטוס

**תיקוני הקוד והבדיקות המקומיות הושלמו. Production נשאר NO-GO. לא בוצעו Deploy, Push, מיגרציות, כתיבות למסד נתונים או פניות לשירותים חיצוניים.**

- קומיט הייחוס המבוקש `61b3bc748177bf955764afe0adae974fa316cb0f` קיים והוא אב קדמון של ה־HEAD המקומי.
- ה־HEAD בעת הבדיקה: `bed9b4a8e35738de5f731edb2fdc2f7813a46e4c` בענף `main`.
- שני הקומיטים שבין קומיט הייחוס ל־HEAD נגעו רק בתיעוד ובמטא־נתונים של נכסי Agent; לא נמצאו ביניהם שינויי runtime, תלויות או הגדרות אבטחה.
- **לא נוצר קומיט Phase 118.** השינויים בדוח ובקוד נמצאים בעץ עבודה מקומי ולא מקומטים.
- לא שונתה תצורה או סביבת משתנים. `render.yaml` עדיין מציג `CLOUD_CUTOVER_APPROVED: "0"`; ערכי Secrets בסביבה לא נבדקו.

## 1. תיקון `/healthz`

- `artifacts/api-server/src/routes/bot-health.ts:5-13` — `/healthz` מחזיר `200` כבדיקת liveness של ה־API ואינו בודק את מצב ה־Telegram Worker. בדיקת Worker נפרדת נמצאת ב־`/worker-healthz`; היא קוראת רק ל־`telegramWorkerReady()` ואינה מפעילה Worker.
- `artifacts/api-server/src/routes/health.ts:7-11` — גם `/api/healthz` מחזיר מצב שירות תקין ללא תלות ב־Worker.
- `artifacts/api-server/src/index.ts:141` — הפעלת Worker נשארת מאחורי `shouldStartTelegramWorker(process.env)`. מדיניות Staging ממשיכה לדרוש `TELEGRAM_WORKER_ENABLED=true`; כשהערך `false`, ה־Worker אינו מופעל.

**ראיות בדיקה:** בדיקות handler מבודדות מאמתות ש־`/healthz` ו־`/api/healthz` מחזירים `200` כשה־Worker כבוי ושמונה של קריאות probe ל־Worker נשאר אפס. בדיקה נפרדת מאמתת ש־`/worker-healthz` מדווח `503` כשה־Worker כבוי, בלי להפעיל אותו. בדיקות המדיניות מאמתות שה־Worker לא מתחיל ב־Staging ללא אישור מפורש.

## 2. בידוד אתחול Billing

- `artifacts/api-server/src/lib/whop-config.ts:6-8` — `billingRuntimeEnabled()` מחזיר `false` אם אחד ממזהי הפריסה או הנתונים מצביע על Staging. כך גם זהות חלקית או לא תואמת משביתה את Billing.
- `artifacts/api-server/src/index.ts:137-141` — hook האתחול קורא ל־`initializeBilling()` רק כאשר המדיניות מאפשרת זאת. Keep-alive נשאר חסום ל־Staging בתוך `self-keep-alive.ts:26-39`.
- `artifacts/api-server/src/lib/billing-runtime.ts:15-22` — טעינת DB pool ויצירת Whop client נדחו ל־dynamic imports; המודול אינו בונה אותם בזמן import.
- `artifacts/api-server/src/lib/billing-runtime.ts:64-74` — `initializeBilling()` עוצר את ה־runtime ומחזיר לפני בדיקת Sandbox, טעינת DB, יצירת client, DDL, פנייה ל־Whop או תזמון retry/reconciliation.
- `artifacts/api-server/src/lib/billing-runtime.ts:150-170` — בקשת webhook נדחית ב־Staging לפני אתחול Billing; reconciliation חוזרת מיד ללא DB/provider calls.
- `artifacts/api-server/src/lib/billing-runtime.ts:37-42` — `paidPrice()` אינו טוען Whop client כשה־runtime אינו מוכן.

**ראיות בדיקה:** בדיקת VM מפעילה את מסלולי האתחול והקריאות העקיפות עם מזהי Staging, `NODE_ENV=production`, הגדרות Sandbox מלאות, `WHOP_MODE=live` ו־checkout כבוי. ה־DB pool וה־Whop client מזויפים ונמדדים. הבדיקה מאמתת אפס טעינות של מודולי DB/Whop/webhook/reconciliation, אפס SQL/DDL, אפס קריאות provider/HTTP, ואפס timers. בדיקה נוספת מאמתת את התנהגות pool: יצירתו בזמן import אינה קוראת ל־`connect` או ל־`query`; הפונקציות האלו הוחלפו ב־throws לפני ההרצה.

## קבצים ששונו

| קובץ | שורות רלוונטיות | שינוי |
|---|---:|---|
| `artifacts/api-server/src/routes/health.ts` | 7-11 | הסרת תלות ה־health ב־Telegram Worker |
| `artifacts/api-server/src/routes/bot-health.ts` | 5-13 | הפרדת liveness מ־worker health |
| `artifacts/api-server/src/lib/whop-config.ts` | 6-8 | מדיניות חסימת Billing לפי זהות Staging |
| `artifacts/api-server/src/index.ts` | 10-11, 137-141 | Billing startup מותנה במדיניות; Telegram נשאר מותנה ב־worker switch |
| `artifacts/api-server/src/lib/billing-runtime.ts` | 1-22, 64-74, 150-170 | טעינת DB/Whop עצלה וחסימות מוקדמות לכל מסלולי Billing |
| `artifacts/api-server/src/lib/self-keep-alive.ts` | 9-39 | ביטול timer ויציאת HTTP ב־Staging |
| `artifacts/api-server/tests/render-service.test.mjs` | 23-70, 72-114 | בדיקות health, worker probe ומדיניות הפעלת Worker |
| `artifacts/api-server/tests/self-keep-alive.test.mjs` | 55-69 | בדיקת היעדר timer/HTTP ב־Staging |
| `artifacts/api-server/tests/billing-runtime-staging.test.mjs` | 1-205 | בדיקות mocks ל־Billing, import chain ו־DB pool |

## בדיקות שבוצעו

1. `pnpm run typecheck` — **PASS**. Typecheck של הספריות, API server, mockup sandbox ו־scripts הסתיים ללא שגיאות.
2. `pnpm --filter @workspace/api-server test` דרך סביבת Lab מבודדת — **74/74 PASS**.
   - הניסיון הראשון עם סביבת הירושה נעצר לפני הרצת בדיקות: ה־guard זיהה מזהה DB מסוג Production/live.
   - לאחר מכן הורדו ממשתני תהליך הבדיקה בלבד כל משתני יעד ה־DB וה־Lab SQL. לא נבדקו ערכיהם ולא שונו Secrets שמורים. `run-lab-tests.mjs` העביר לתהליך הבדיקות סביבת mock-only נקייה, ללא `DATABASE_URL` או `LAB_DATABASE_URL`.
   - הסוויטה כללה בדיקות בידוד DB, health, Billing, Whop Sandbox ו־Egress; הבדיקות החיצוניות השתמשו ב־mocks/fakes.
3. בדיקת Phase 118 הממוקדת דרך runner — **21/21 PASS**.
4. `git diff --check` — **PASS**.

## בדיקות שלא בוצעו

- לא הופעל שרת או workflow, ולכן `/healthz` לא נבדק דרך HTTP מול תהליך חי.
- לא בוצעה בדיקה מול Render, מסד נתונים, Telegram או Whop — בהתאם למגבלות השלב.
- לא בוצעה בדיקת Build/Deploy או מיגרציה.

## סקירת startup וסיכונים שנותרו

- בדקתי את `artifacts/api-server/src/index.ts` ואת import chain של Billing. Billing startup וה־webhook אינם טוענים DB/Whop ב־Staging.
- `lib/db/src/index.ts:8-21` עדיין יוצר אובייקט `pg.Pool` בעת טעינת חבילת DB. בדיקת pool עם `connect`/`query` חסומים לא מצאה חיבור או שאילתה בזמן import; ה־DB guard הקיים ממשיך לאמת את זהות היעד לפני יצירת ה־pool.
- קיימים אתחולי סכימה עצלים אחרים, למשל `initializeMiniAppStorage()` ו־`initializeEmailIdentity()`. לפי call sites שנבדקו הם מופעלים מתוך מסלולי API/פיצ'רים ולא מתוך hook האתחול. הם **לא** הושבתו בשלב זה; גישה למסלולים הרלוונטיים ב־Staging עשויה להפעיל DDL/DB calls, ויש לאשר זאת בנפרד לפני תעבורה או בדיקות משתמשים.
- `/healthz` הוא liveness בלבד, לא בדיקת זמינות DB או Billing. `/worker-healthz` נשאר נפרד ומחזיר מצב Worker; הוא אינו מפעיל אותו.
- לא הוכח מצב השירות בפועל ב־Render, ולא אומתה תצורת Secrets או DB שם.

## החלטה והמשך

**GO לבדיקת קוד מקומית בלבד; NO-GO להפעלת Staging או Production.** לפני יצירת תשתית או פתיחת תעבורה נדרשת סקירה אנושית של השינויים, בדיקה נפרדת של DDL לפי דרישה במסלולי API, ובדיקת health מול סביבת Staging רק לאחר אישור מתאים.

לא בוצעו Push, Deploy, שינוי Secrets, שינוי DB או שינוי `CLOUD_CUTOVER_APPROVED`. יש להמתין לאישור אנושי לפני כל צעד נוסף.
