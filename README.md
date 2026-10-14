# אח שלי — תיקון מבנה הפרויקט

ענף בדיקה בלבד. הקבצים מסודרים כאן במבנה המקורי של הפרויקט, במקום ההעלאה השטוחה ושרת הבדיקה שהחזיר `Yotibot is running!`.

```text
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
node --test scripts/cloud-start.test.mjs scripts/telegram-render-webhook.test.mjs
```

פקודות אלה אינן מיועדות להפעלת הבוט. אין להפעיל `index.js` בזמן בדיקת הענף עם טוקן הבוט הפעיל.

## הפעלת הבוט ישירות ב־Render — ללא cloud-start.mjs

רק לאחר בדיקת הענף, אישור מעבר ועצירת הבוט הישן:

- Node: גרסה 22.18 ומעלה.
- Root Directory: `artifacts/ah-sheli-bot`.
- Build Command: `npm install --global pnpm@10.26.1 && pnpm install --frozen-lockfile --prod=false`.
- Start Command: `node index.js`.
- Health Check Path: `/healthz`.
- `NODE_ENV=production`.
- `TELEGRAM_WEBHOOK_URL=https://yotibot-azbu.onrender.com/telegram/webhook`.
- `PORT` מסופק על ידי Render.
- הגדר במנהל הסודות של Render את `TELEGRAM_BOT_TOKEN`, את `DATABASE_URL` של Production ואת מפתחות ספק ה־AI הקיים. שמור את `SESSION_SECRET` הקיים אם משתמשים בנתונים מוצפנים.

הבוט רושם את ה־Webhook בעצמו באתחול, עם סוד האימות הקיים ב־SQL ובלי למחוק הודעות ממתינות. עלייה תקינה מחזירה ב־`/healthz` זיהוי `ah-sheli-bot` ומצב `ready: true`.

כלי בדיקה ללא שינוי ב־Webhook:

```sh
node scripts/telegram-render-webhook.mjs --check --direct
```

את כלי הבדיקה מריצים משורש המאגר. תיקון ידני באמצעות `--apply --direct` מחייב בנוסף `CLOUD_CUTOVER_APPROVED=1`, ורק אחרי אימות שהתהליך הישן נעצר ושהמסד תואם לשרת.

## מה לא משתנה בענף הזה

- אין העברת נתונים, יצירת משתמשים או שינוי טבלאות במסד הנתונים.
- אין שינוי בפלטת הצבעים או בממשק.
- אין העתקת סודות, תמונות פרטיות שהועלו, דוחות בדיקה, גיבויים או היסטוריית Git מקומית.
- אין שינוי ב־Webhook החי או הפעלת תהליך בוט נוסף.
- אין מיזוג אוטומטי ל־main או שינוי בהגדרות שירות Render.

הפעלה ישירה זו מפעילה את הבוט בלבד. האתר והמיני־אפליקציה דורשים את שרת ה־API; שינוי כתובות ההתחברות, היומן והתשלומים נשאר שלב מעבר נפרד. אין לשנות אותם במסגרת תיקון המבנה.
