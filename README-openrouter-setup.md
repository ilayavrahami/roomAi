# חיבור ל-OpenRouter (DeepSeek) דרך Netlify Functions

התכנון הדו-ממדי (`pages/planner-2d.html`) קורא כעת לפונקציית שרת משלכם
(`netlify/functions/generate-plan.js`) במקום לקרוא ל-API של ספק ה-AI
ישירות מהדפדפן. הפונקציה מחזיקה את מפתח ה-API כמשתנה סביבה בצד השרת
בלבד — הוא **לעולם לא** נחשף לדפדפן של המבקרים באתר.

## שלבי הגדרה

1. **פרסו את התיקייה הזו כפי שהיא** (עם `netlify.toml` בשורש) לאתר Netlify —
   דרך Git (מומלץ) או גרירת התיקייה ל-Netlify Drop.

2. **קבלו מפתח API מ-OpenRouter**: היכנסו ל-https://openrouter.ai ,
   Sign in → Keys → Create Key. טענו יתרה (credits) בחשבון — כל מודלי
   DeepSeek ב-OpenRouter הם בתשלום (אין יותר גרסאות :free).

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

## החלפת מודל

המודל מוגדר בקובץ `netlify/functions/generate-plan.js`, קבוע `MODEL`.
כרגע: `deepseek/deepseek-v4-flash` (מהיר וזול, מתאים למשימת JSON מובנית
כזו). אם תרצו יותר "חשיבה"/דיוק על חשבון מהירות ומחיר, אפשר להחליף ל-
`deepseek/deepseek-v4-pro`.
