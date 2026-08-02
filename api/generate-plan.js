// api/generate-plan.js  (Vercel Serverless Function)
//
// Server-side proxy: receives room data from the browser, calls OpenRouter
// (a free auto-routed model) with the design system-prompt, and returns a
// clean furniture-layout JSON object to the client.
//
// The OpenRouter API key lives ONLY in the Vercel environment variable
// OPENROUTER_API_KEY — it is never sent to, or visible from, the browser.
// On Vercel this file is automatically served at /api/generate-plan —
// no extra routing config needed.
//
// IMPORTANT: every code path below sends a proper JSON response via
// res.status(...).json(...). The whole handler is wrapped in one outer
// try/catch so an unexpected error (a bug, a network blip, a malformed
// 3rd-party response) can never bubble up as a raw error page — the
// browser should always get valid JSON to parse.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter's free auto-router: picks whichever free model is currently
// available instead of a pinned slug, so this keeps working as providers
// rotate their free lineup in and out (DeepSeek itself has no free models
// on OpenRouter as of mid-2026 — see README troubleshooting section).
// Trade-off: quality/latency vary by whichever model gets picked, and it's
// shared/rate-limited across all OpenRouter free-tier traffic.
const MODEL = 'openrouter/free';

const SYSTEM_PROMPT = `אתה אדריכל פנים בכיר ומנוע תכנון חללים. תפקידך לקבל נתוני חדר ולהחזיר אך ורק אובייקט JSON תקין (ללא טקסט נוסף, ללא Markdown) בפורמט הבא:
{"furniture": [ ... ]}

כללים לגבי מערך furniture:
- מערכת קואורדינטות: (0,0) בפינה הצפון-מערבית של החדר. ציר X גדל מזרחה. ציר Y גדל דרומה. כל הערכים בס"מ.
- שמור מרחק פינוי של 90 ס"מ מרדיוס פתיחת כל דלת, ומעברי הליכה של לפחות 60 ס"מ.
- אל תחסום חלונות עם רהיטים גבוהים.
- אל תגרום לחפיפה בין פריטי ריהוט.
- כל פריט: {"id":"item_1","type":"bed|sofa|desk|wardrobe|table|chair|shelf|nightstand|dresser|rug|other","name":"שם קצר בעברית","x":number,"y":number,"width":number,"length":number,"rotation":0|90|180|270}
- החזר בין 4 ל-10 פריטים המתאימים לסוג החדר, לסגנון ולתקציב.
- החזר אך ורק את אובייקט ה-JSON {"furniture": [...]}. שום דבר נוסף — לא הסברים, לא Markdown.`;

// Pulls a furniture array out of a model response, whether the model
// returned a bare array, an object like {"furniture": [...]}, or (if
// response_format wasn't honored) plain text with a JSON blob inside it.
function extractFurniture(rawText) {
  const cleaned = String(rawText || '').replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.furniture)) return parsed.furniture;
  } catch (err) {
    // fall through to regex fallback below
  }

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed.furniture)) return parsed.furniture;
    } catch (err) {
      // ignore, try array fallback next
    }
  }

  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      // give up
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  // Same-origin on Vercel (frontend + /api on one domain) so CORS isn't
  // strictly required, but harmless to keep for local dev / previews.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('generate-plan: missing OPENROUTER_API_KEY env var');
      res.status(500).json({ error: 'שרת לא מוגדר כראוי (חסר מפתח API). פנו למנהל האתר.' });
      return;
    }

    // Vercel Node.js functions auto-parse JSON bodies into req.body.
    const room = req.body && req.body.room;
    if (!room || typeof room !== 'object') {
      res.status(400).json({ error: 'בקשה לא תקינה' });
      return;
    }

    const userMsg = `נתוני החדר:\n${JSON.stringify(room, null, 2)}`;

    const baseRequestBody = {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 1500,
    };

    const callOpenRouter = (body) =>
      fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          // Recommended by OpenRouter for attribution / rate-limit dashboards.
          'HTTP-Referer': 'https://roomai.example.com',
          'X-Title': 'RoomAI',
        },
        body: JSON.stringify(body),
      });

    let orResponse;
    try {
      // openrouter/free can land on any one of several rotating free
      // models, and not all of them support strict JSON mode. Ask for it
      // first; if the provider rejects the param outright, retry once
      // without it and lean on extractFurniture()'s regex fallback below.
      orResponse = await callOpenRouter({ ...baseRequestBody, response_format: { type: 'json_object' } });

      if (!orResponse.ok && orResponse.status === 400) {
        console.warn('generate-plan: retrying without response_format (model may not support it)');
        orResponse = await callOpenRouter(baseRequestBody);
      }
    } catch (networkErr) {
      console.error('generate-plan: network error calling OpenRouter', networkErr);
      res.status(502).json({ error: 'לא ניתן היה להתחבר לשרת ה-AI. נסו שוב.' });
      return;
    }

    if (!orResponse.ok) {
      const errText = await orResponse.text().catch(() => '');
      console.error('OpenRouter error', orResponse.status, errText);
      res.status(502).json({ error: `שגיאה משרת ה-AI (${orResponse.status})` });
      return;
    }

    let data;
    try {
      data = await orResponse.json();
    } catch (parseErr) {
      console.error('generate-plan: OpenRouter response was not JSON', parseErr);
      res.status(502).json({ error: 'תשובה לא תקינה משרת ה-AI' });
      return;
    }

    const rawText = data?.choices?.[0]?.message?.content || '';
    const furniture = extractFurniture(rawText);

    if (!furniture) {
      console.error('generate-plan: no usable furniture JSON in model output:', rawText);
      res.status(502).json({ error: 'לא התקבל JSON תקין מהמודל' });
      return;
    }

    res.status(200).json({ furniture });
  } catch (err) {
    // Last-resort safety net: guarantees the browser NEVER receives an
    // HTML error page / raw stack trace instead of JSON.
    console.error('generate-plan: unexpected error', err);
    res.status(500).json({ error: 'שגיאה לא צפויה בשרת. נסו שוב.' });
  }
};
