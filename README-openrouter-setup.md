# חיבור ל-OpenRouter (DeepSeek) דרך Netlify Functions

התכנון הדו-ממדי (`pages/planner-2d.html`) קורא כעת לפונקציית שרת משלכם
(`netlify/functions/generate-plan.js`) במקום לקרוא ל-API של ספק ה-AI
ישירות מהדפדפן. הפונקציה מחזיקה את מפתח ה-API כמשתנה סביבה בצד השרת
בלבד — הוא **לעולם לא** נחשף לדפדפן של המבקרים באתר.

## שלבי הגדרה

1. **פרסו את התיקייה הזו כפי שהיא** (עם `netlify.toml` בשורש) לאתר Netlify —
   דרך Git (מומלץ) או גרירת התיקייה ל-Netlify Drop.

2. **קבלו מפתח API מ-OpenRouter**: היכנסו ל-https://openrouter.ai ,
   Sign in → Keys → Create Key. **הערה:** נכון לאמצע 2026, למודלי
   DeepSeek אין יותר גרסאות `:free` ב-OpenRouter — הפונקציה מוגדרת
   כרגע להשתמש ב-`openrouter/free`, ה-auto-router של OpenRouter
   שבוחר אוטומטית מודל חינמי זמין (מתחלף מדי פעם ככל שספקים
   מכניסים/מוציאים הצעות חינמיות). מפתח API עדיין נדרש (ליצירתו
   אין עלות), אבל אין צורך לטעון קרדיט כדי להשתמש במסלול הזה —
   רק אם תרצו לעבור למודל בתשלום ספציפי (ראו "החלפת מודל" למטה).

3. **הגדירו את משתנה הסביבה ב-Netlify**:
   Site settings → Environment variables → Add a variable
   - Key: `OPENROUTER_API_KEY`
   - Value: המפתח שקיבלתם מ-OpenRouter
   - Scope: Functions (או All)

4. **בצעו Deploy מחדש** לאחר הוספת המשתנה, כדי שהפונקציה תטען אותו.

5. בדקו ב-`pages/planner-2d.html` → "צור פריסת חדר עם AI".

## פיתוח מקומי (אופציונלי)

עם [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify dev
```

צרו קובץ `.env` בשורש הפרויקט (לא לוותר על .gitignore!) עם:

```
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
```

`netlify dev` יטען אותו אוטומטית ויריץ גם את השרת המקומי וגם את הפונקציה.

## פתרון תקלות

**שגיאה בדפדפן: `Unexpected token 'T', "The page c"... is not valid JSON`**

זה קורה כשהבקשה ל-`/.netlify/functions/generate-plan` חוזרת עם עמוד HTML
(בדרך כלל 404) במקום JSON — כלומר הפונקציה לא נמצאה בפריסה. הגרסה
המעודכנת של `pages/planner-2d.html` כבר תופסת את המקרה הזה ומציגה הודעה
ברורה במקום לקרוס, אבל כדי לתקן את הבעיה עצמה בדקו:

1. שהאתר באמת פרוס דרך **Netlify** (ולא, למשל, GitHub Pages / שרת
   סטטי אחר) — הנתיב `/.netlify/functions/...` קיים רק ב-Netlify.
2. ש-`netlify.toml` נמצא בשורש הריפו שפרסתם, ומצביע ל-
   `functions = "netlify/functions"`.
3. שהקובץ `netlify/functions/generate-plan.js` אכן עלה לפריסה (בדקו
   ב-Netlify: Site → Functions — הפונקציה `generate-plan` אמורה להופיע
   ברשימה).
4. אם פרסתם דרך גרירת תיקייה (Drag & Drop) ולא Git — ודאו שגררתם את
   כל התיקייה `roomai/` כולל `netlify/`, ולא רק את קבצי ה-HTML/CSS/JS.
5. בדקו בלוגים של הפונקציה (Site → Functions → generate-plan → Logs)
   אם יש שגיאות בזמן ריצה.

## החלפת מודל

המודל מוגדר בקובץ `netlify/functions/generate-plan.js`, קבוע `MODEL`.
כרגע: `openrouter/free` — ה-auto-router של OpenRouter, שבוחר בכל בקשה
מודל חינמי זמין. יתרון: אין עלות ואין תלות במודל ספציפי שעלול
להיעלם. חיסרון: איכות/עקביות הפלט יכולות להשתנות בין קריאה לקריאה,
כי לא תמיד אותו מודל עונה. הקוד כבר בנוי לכך — הוא מנסה לבקש JSON
מובנה (`response_format`), ונופל בחזרה על חילוץ JSON בעזרת regex אם
המודל שנבחר לא תומך בכך.

אם תרצו יציבות ואיכות גבוהה יותר על חשבון תשלום, אפשר להחליף בחזרה
למודל DeepSeek קבוע, למשל `deepseek/deepseek-v4-flash` (מהיר וזול)
או `deepseek/deepseek-v4-pro` (יותר "חשיבה"/דיוק) — במקרה הזה תצטרכו
לטעון קרדיט בחשבון ה-OpenRouter.
