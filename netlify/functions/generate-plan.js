// netlify/functions/generate-plan.js
//
// Server-side proxy: receives room data from the browser, calls OpenRouter
// (DeepSeek model) with the design system-prompt, and returns a clean
// furniture-layout JSON object to the client.
//
// The OpenRouter API key lives ONLY in the Netlify environment variable
// OPENROUTER_API_KEY — it is never sent to, or visible from, the browser.
//
// IMPORTANT: every single code path below returns a proper
// { statusCode, headers, body } response with a JSON body. The whole
// handler is wrapped in one outer try/catch so that even a truly
// unexpected error (a bug, a network blip, a malformed 3rd-party
// response) can never bubble up as a raw Lambda error page / HTML —
// the browser should always get valid JSON to parse.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash'; // fast + cheap, good enough for structured JSON layout tasks

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

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

// Pulls a furniture array out of a model response, whether the model
// returned a bare array, an object like {"furniture": [...]}, or (if
// response_format wasn't honored) plain text with a JSON blob inside it.
function extractFurniture(rawText) {
  const cleaned = String(rawText || '').replace(/```json|```/g, '').trim();

  // Try a direct parse first — this is the expected path when
  // response_format: json_object worked.
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.furniture)) return parsed.furniture;
  } catch (err) {
    // fall through to regex fallback below
  }

  // Fallback: pull out the first {...} or [...] blob we can find.
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: JSON_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('generate-plan: missing OPENROUTER_API_KEY env var');
      return jsonResponse(500, { error: 'שרת לא מוגדר כראוי (חסר מפתח API). פנו למנהל האתר.' });
    }

    let room;
    try {
      const body = JSON.parse(event.body || '{}');
      room = body.room;
      if (!room || typeof room !== 'object') throw new Error('missing room');
    } catch (err) {
      return jsonResponse(400, { error: 'בקשה לא תקינה' });
    }

    const userMsg = `נתוני החדר:\n${JSON.stringify(room, null, 2)}`;

    let orResponse;
    try {
      orResponse = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          // Recommended by OpenRouter for attribution / rate-limit dashboards.
          'HTTP-Referer': 'https://roomai.example.com',
          'X-Title': 'RoomAI',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.4,
          max_tokens: 1500,
          // Ask OpenRouter/DeepSeek to guarantee a parsable JSON body,
          // instead of relying purely on prompt instructions.
          response_format: { type: 'json_object' },
        }),
      });
    } catch (networkErr) {
      console.error('generate-plan: network error calling OpenRouter', networkErr);
      return jsonResponse(502, { error: 'לא ניתן היה להתחבר לשרת ה-AI. נסו שוב.' });
    }

    if (!orResponse.ok) {
      const errText = await orResponse.text().catch(() => '');
      console.error('OpenRouter error', orResponse.status, errText);
      return jsonResponse(502, { error: `שגיאה משרת ה-AI (${orResponse.status})` });
    }

    let data;
    try {
      data = await orResponse.json();
    } catch (parseErr) {
      console.error('generate-plan: OpenRouter response was not JSON', parseErr);
      return jsonResponse(502, { error: 'תשובה לא תקינה משרת ה-AI' });
    }

    const rawText = data?.choices?.[0]?.message?.content || '';
    const furniture = extractFurniture(rawText);

    if (!furniture) {
      console.error('generate-plan: no usable furniture JSON in model output:', rawText);
      return jsonResponse(502, { error: 'לא התקבל JSON תקין מהמודל' });
    }

    return jsonResponse(200, { furniture });
  } catch (err) {
    // Last-resort safety net: guarantees the browser NEVER receives an
    // HTML error page / raw stack trace instead of JSON.
    console.error('generate-plan: unexpected error', err);
    return jsonResponse(500, { error: 'שגיאה לא צפויה בשרת. נסו שוב.' });
  }
};
