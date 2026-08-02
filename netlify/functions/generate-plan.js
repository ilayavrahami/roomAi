// netlify/functions/generate-plan.js
//
// Server-side proxy: receives room data from the browser, calls OpenRouter
// (DeepSeek model) with the design system-prompt, and returns a clean
// furniture-layout JSON array to the client.
//
// The OpenRouter API key lives ONLY in the Netlify environment variable
// OPENROUTER_API_KEY — it is never sent to, or visible from, the browser.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash'; // fast + cheap, good enough for structured JSON layout tasks

const SYSTEM_PROMPT = `אתה אדריכל פנים בכיר ומנוע תכנון חללים. תפקידך לקבל נתוני חדר ולהחזיר אך ורק מערך JSON תקין (ללא טקסט נוסף, ללא Markdown) של פריטי ריהוט לפריסה דו-ממדית עילית (top-down).
כללים:
- מערכת קואורדינטות: (0,0) בפינה הצפון-מערבית של החדר. ציר X גדל מזרחה. ציר Y גדל דרומה. כל הערכים בס"מ.
- שמור מרחק פינוי של 90 ס"מ מרדיוס פתיחת כל דלת, ומעברי הליכה של לפחות 60 ס"מ.
- אל תחסום חלונות עם רהיטים גבוהים.
- אל תגרום לחפיפה בין פריטי ריהוט.
- כל פריט: {"id":"item_1","type":"bed|sofa|desk|wardrobe|table|chair|shelf|nightstand|dresser|rug|other","name":"שם קצר בעברית","x":number,"y":number,"width":number,"length":number,"rotation":0|90|180|270}
- החזר בין 4 ל-10 פריטים המתאימים לסוג החדר, לסגנון ולתקציב.
- החזר אך ורק את מערך ה-JSON. שום דבר נוסף.`;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('generate-plan: missing OPENROUTER_API_KEY env var');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'שרת לא מוגדר כראוי (חסר מפתח API). פנו למנהל האתר.' }),
    };
  }

  let room;
  try {
    const body = JSON.parse(event.body || '{}');
    room = body.room;
    if (!room || typeof room !== 'object') throw new Error('missing room');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'בקשה לא תקינה' }) };
  }

  const userMsg = `נתוני החדר:\n${JSON.stringify(room, null, 2)}`;

  try {
    const response = await fetch(OPENROUTER_URL, {
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
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenRouter error', response.status, errText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `שגיאה משרת ה-AI (${response.status})` }),
      };
    }

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);

    if (!match) {
      console.error('generate-plan: no JSON array found in model output:', rawText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'לא התקבל JSON תקין מהמודל' }),
      };
    }

    let furniture;
    try {
      furniture = JSON.parse(match[0]);
    } catch (err) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'לא ניתן היה לפענח את תשובת המודל' }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ furniture }) };
  } catch (err) {
    console.error('generate-plan: unexpected error', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'שגיאה לא צפויה בשרת. נסו שוב.' }),
    };
  }
};
