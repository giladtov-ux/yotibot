# אח שלי — תיקון מבנה הפרויקט

ענף הכנה למעבר מלא ל־Render: האתר, המיני־אפליקציה ובוט Telegram באותו שירות, עם אותו מסד Production. אין למזג או להפעיל לפני השלמת האימות והמעבר המבוקר.

```text
index.js                כניסה מהשורש ל־Render; מפעילה את שרת ה־API המלא
artifacts/ah-sheli-bot/   הבוט האמיתי: index.js וקובצי src
artifacts/api-server/    האתר, המיני־אפליקציה וממשקי השרת
lib/                    ספריות משותפות והגדרות סכמת הנתונים
scripts/                כלי בדיקה ופריסה
pnpm-workspace.yaml     הגדרת חבילות הפרויקט
pnpm-lock.yaml          גרסאות התלויות
```

## בדיקה לפני הפעלה

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/ah-sheli-bot run check
pnpm --filter @workspace/api-server run build
node --test scripts/cloud-start.test.mjs scripts/telegram-render-webhook.test.mjs scripts/render-root-start.test.mjs
node --test artifacts/api-server/tests/render-service.test.mjs artifacts/api-server/tests/google-calendar-oauth.test.mjs
```

פקודות אלה אינן מיועדות להפעלת הבוט. אין להפעיל `index.js` בזמן בדיקת הענף עם טוקן הבוט הפעיל.

## הפעלת כל המערכת ב־Render

רק לאחר בדיקת הענף, אישור מעבר ועצירת הבוט הישן:

- Node: גרסה 22.18 ומעלה.
- Root Directory: להשאיר ריק (שורש המאגר).
- Build Command: `npm install --global pnpm@10.26.1 && pnpm install --frozen-lockfile --prod=false && pnpm --filter @workspace/api-server run build`.
- Start Command: `node index.js`.
- Health Check Path: `/healthz`.
- `NODE_ENV=production`.
- `CLERK_AUTH_MODE=external` עם חשבון Clerk חיצוני שהוגדר ונבדק בנפרד. האימות המנוהל בידי Replit אינו נייד ל־Render.
- `PUBLIC_APP_URL=https://yotibot-azbu.onrender.com`.
- `GOOGLE_CALENDAR_REDIRECT_URI=https://yotibot-azbu.onrender.com/api/mini-app/calendar/callback`.
- `CLOUD_CUTOVER_APPROVED=1` רק אחרי אישור המעבר ועצירת הבוט הישן. הכניסה מהשורש חוסמת הפעלה ב־Production ללא אישור זה.
- `TELEGRAM_WEBHOOK_URL=https://yotibot-azbu.onrender.com/telegram/webhook`.
- `PORT` מסופק על ידי Render.
- הגדר במנהל הסודות של Render את `TELEGRAM_BOT_TOKEN`, את `DATABASE_URL` של Production ואת מפתחות ספק ה־AI הקיים. שמור את `SESSION_SECRET` הקיים אם משתמשים בנתונים מוצפנים.

הבוט רושם את ה־Webhook בעצמו באתחול, עם סוד האימות הקיים ב־SQL ובלי למחוק הודעות ממתינות. עלייה תקינה מחזירה ב־`/healthz` זיהוי `ah-sheli-bot` ומצב `ready: true`.

קובץ `index.js` בשורש טוען את ה־API שנבנה. ה־API מגיש את האתר והמיני־אפליקציה ומפעיל תהליך בוט יחיד בפורט פנימי 18081. נתיב הקבלה הציבורי `/telegram/webhook` מעביר אליו את ההודעות עם סוד האימות. מנגנון פעולות המיני־אפליקציה הקיים נשאר באותו שרת וממשיך לפעול דרך אותו כותב SQL יחיד. אין להפעיל בוט נוסף בנפרד.

`/healthz` ו־`/api/healthz` מחזירים 503 ב־Production עד שתהליך הבוט מוכן, ולא רק משום ששרת HTTP עלה.

כלי בדיקה ללא שינוי ב־Webhook:

```sh
node scripts/telegram-render-webhook.mjs --check --direct
```

את כלי הבדיקה מריצים משורש המאגר. תיקון ידני באמצעות `--apply --direct` מחייב בנוסף `CLOUD_CUTOVER_APPROVED=1`, ורק אחרי אימות שהתהליך הישן נעצר ושהמסד תואם לשרת.

## תנאים שחוסמים הפעלה

1. להגדיר Clerk חיצוני ולאמת מעבר של חשבונות האתר וקישוריהם ל־SQL לפני החלפת המפתחות. אין כאן העברת משתמשים אוטומטית או אישור לה.
2. לשמור את אותו `DATABASE_URL` של Production ואת אותו `SESSION_SECRET`; לא להעתיק נתוני פיתוח מעל Production.
3. לאשר בגוגל את כתובת הקולבק החדשה ולהגדיר את מפתחות Whop הישירים והמסלולים הקיימים ב־Render. אין להעתיק אישורי connector של Replit.
4. מפתחות Clerk החיצוניים חייבים להתאים בבנייה ובהרצה. אין להעתיק `GITHUB_PAT` ל־Render.
5. לעצור את השירות הישן שמפקח על הבוט לפני אישור המעבר, כדי שלא יפעיל אותו מחדש. רק אז להגדיר `CLOUD_CUTOVER_APPROVED=1`.

אין התחייבות לתזמון תזכורות כשהאירוח מרדים את התהליך. פעימה עצמית היא מאמץ מיטבי בלבד. הקובץ render.yaml הוא תבנית בלבד; אין ליצור שירות או מסלול בתשלום ללא אישור מפורש.

## מה לא משתנה בענף הזה

- אין העברת נתונים, יצירת משתמשים או שינוי טבלאות במסד הנתונים.
- אין שינוי בפלטת הצבעים או בממשק.
- אין העתקת סודות, תמונות פרטיות שהועלו, דוחות בדיקה, גיבויים או היסטוריית Git מקומית.
- אין שינוי ב־Webhook החי או הפעלת תהליך בוט נוסף.
- אין מיזוג אוטומטי ל־main או שינוי בהגדרות שירות Render.

פרטים נוספים וכתובות שירות ב־CLOUD_DEPLOYMENT.md. הכנת הקוד אינה מוכיחה שהתחברות, תשלום או Google OAuth פועלים מול שירותים חיצוניים; אלה נבדקים רק לאחר הגדרה בטוחה, לפני הפעלה.
