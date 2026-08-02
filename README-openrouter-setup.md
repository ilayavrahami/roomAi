# חיבור ל-OpenRouter דרך Vercel Serverless Functions

התכנון הדו-ממדי (`pages/planner-2d.html`) קורא לפונקציית שרת משלכם
(`api/generate-plan.js`) במקום לקרוא ל-API של ספק ה-AI ישירות
מהדפדפן. הפונקציה מחזיקה את מפתח ה-API כמשתנה סביבה בצד השרת בלבד —
הוא **לעולם לא** נחשף לדפדפן של המבקרים באתר.

ב-Vercel, כל קובץ בתיקיית `api/` הופך אוטומטית לנתיב שרת. אין צורך
בקובץ קונפיגורציה מיוחד (`vercel.json`) עבור זה — `api/generate-plan.js`
יהיה זמין אוטומטית בכתובת `/api/generate-plan`.

## שלבי הגדרה

1. **פרסו את התיקייה הזו** ל-Vercel:
   - **דרך Git (מומלץ):** חברו את הריפו ב-https://vercel.com/new —
     ודאו ש-`api/generate-plan.js` נמצא בשורש הריפו (לא בתת-תיקייה),
     כלומר `index.html`, `api/`, `css/`, `js/`, `pages/` כולם באותה
     רמה.
   - **דרך Vercel CLI:** `npx vercel` מתוך תיקיית הפרויקט.

2. **קבלו מפתח API מ-OpenRouter**: https://openrouter.ai → Sign in →
   Keys → Create Key.
   הפונקציה מוגדרת כרגע להשתמש ב-`openrouter/free` — ה-auto-router של
   OpenRouter שבוחר אוטומטית מודל חינמי זמין (ראו "החלפת מודל" למטה),
   כך שאין צורך לטעון קרדיט כדי להתחיל.

3. **הגדירו את משתנה הסביבה ב-Vercel**:
   Project → Settings → Environment Variables → Add
   - Key: `OPENROUTER_API_KEY`
   - Value: המפתח שקיבלתם מ-OpenRouter
   - Environments: Production (וגם Preview/Development אם רוצים לבדוק שם)

4. **בצעו Redeploy** לאחר הוספת המשתנה (Deployments → ⋮ → Redeploy),
   כדי שהפונקציה תטען אותו.

5. בדקו ב-`pages/planner-2d.html` → "צור פריסת חדר עם AI".

## אמינות ומהירות (חשוב)

הפונקציה שולחת בקשה **במקביל** לכמה מודלים חינמיים (לא ברצף), עם
timeout של 45 שניות לכל בקשה בודדת (`PER_CALL_TIMEOUT_MS`) — כדי שאם
מודל אחד נתקע, הבקשה כולה לא תיתקע איתו עד שה-Function Timeout של
Vercel יהרוג אותה בלי תגובה כלל (בדיוק התסמין "Status: 0 / Waiting
for response"). הפונקציה גם מבקשת מ-Vercel `maxDuration: 60` שניות
(המקסימום הנתמך בתוכנית ה-Hobby החינמית) — שילוב שאמור לתת מרווח
בטוח מעל ה-45 שניות של כל ניסיון בודד.

**עדכון:** בהתחלה הגדרתי timeout של 15 שניות בלבד, וזה היה קצר מדי —
מודלים חינמיים שמייצרים תשובה ארוכה (~4000 טוקנים, כולל התיאור
המילולי המלא) לפעמים לוקחים יותר מ-15 שניות, וה-timeout קטע אותם
באמצע, מה שנראה כמו "כל המודלים נכשלו" בלי שבאמת הייתה שגיאה. 45
שניות אמור לתת מספיק זמן לרוב המודלים להשלים.

## פיתוח מקומי (אופציונלי)

עם [Vercel CLI](https://vercel.com/docs/cli):

```bash
npm install -g vercel
vercel dev
```

צרו קובץ `.env` בשורש הפרויקט (הוסיפו ל-`.gitignore`!) עם:

```
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
```

`vercel dev` יטען אותו אוטומטית ויריץ גם את האתר הסטטי וגם את
`api/generate-plan.js` באותו שרת מקומי.

## פתרון תקלות

**שגיאה בדפדפן: `Unexpected token 'T', "The page c"... is not valid JSON`
או `404` על `/api/generate-plan` ב-Network tab**

זה קורה כשהבקשה ל-`/api/generate-plan` חוזרת עם עמוד HTML (בדרך כלל
404) במקום JSON — כלומר הפונקציה לא נמצאה בפריסה. `pages/planner-2d.html`
כבר תופס את המקרה הזה ומציג הודעה ברורה במקום לקרוס, אבל כדי לתקן את
הבעיה עצמה בדקו:

1. ש-`api/generate-plan.js` נמצא **בשורש** הריפו שפרסתם (לא בתוך
   תת-תיקייה כמו `roomai/api/...`) — אחרת Vercel לא מזהה אותו כ-
   Serverless Function.
2. בדשבורד של Vercel: הפרויקט → **Deployments** → הדפלוי האחרון →
   לשונית **Functions** — `generate-plan` אמורה להופיע ברשימה. אם
   היא לא שם, הבעיה היא במבנה התיקיות (סעיף 1) או ב-Root Directory
   שהוגדר בהגדרות הפרויקט (Settings → General → Root Directory —
   צריך להיות ריק אם `api/` נמצא בשורש הריפו).
3. בדקו לוגים: Deployments → הדפלוי → Functions → `generate-plan` →
   Logs, לשגיאות בזמן ריצה (למשל מפתח API חסר).
4. ודאו ש-`OPENROUTER_API_KEY` הוגדר ושבוצע Redeploy אחריו — משתני
   סביבה חדשים לא חלים על דפלוי קיים.

## החלפת מודל

המודל מוגדר בקובץ `api/generate-plan.js`, קבוע `MODEL`.
כרגע: `openrouter/free` — ה-auto-router של OpenRouter, שבוחר בכל בקשה
מודל חינמי זמין. יתרון: אין עלות ואין תלות במודל ספציפי שעלול
להיעלם. חיסרון: איכות/עקביות הפלט יכולות להשתנות בין קריאה לקריאה,
כי לא תמיד אותו מודל עונה. הקוד כבר בנוי לכך — הוא מנסה לבקש JSON
מובנה (`response_format`), ונופל בחזרה על חילוץ JSON בעזרת regex אם
המודל שנבחר לא תומך בכך.

אם תרצו יציבות ואיכות גבוהה יותר על חשבון תשלום, אפשר להחליף למודל
DeepSeek קבוע, למשל `deepseek/deepseek-v4-flash` (מהיר וזול) או
`deepseek/deepseek-v4-pro` (יותר "חשיבה"/דיוק) — במקרה הזה תצטרכו
לטעון קרדיט בחשבון ה-OpenRouter.
