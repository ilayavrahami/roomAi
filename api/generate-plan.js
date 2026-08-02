// api/generate-plan.js  (Vercel Serverless Function)
//
// Server-side proxy: receives room data from the browser, calls OpenRouter
// (a free auto-routed model) with a rich interior-design prompt, and
// returns both a human-readable design write-up ("report") and a clean
// furniture-layout JSON array ("furniture") extracted from it.
//
// The OpenRouter API key lives ONLY in the Vercel environment variable
// OPENROUTER_API_KEY — it is never sent to, or visible from, the browser.
//
// IMPORTANT: every code path below sends a proper JSON response via
// res.status(...).json(...). The whole handler is wrapped in one outer
// try/catch so an unexpected error can never bubble up as a raw error
// page — the browser should always get valid JSON to parse.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// A ranked list of specific free, non-OpenAI models to try, instead of
// relying on OpenRouter's random "openrouter/free" auto-router — that
// router can land on a weak free model that ignores complex multi-section
// instructions entirely, which is what produced the empty/unparseable
// response. We try each candidate in order and stop at the first one
// that returns text we can actually extract a report + JSON from.
// NOTE: free model IDs on OpenRouter churn every few weeks — if all of
// these ever return 404, check https://openrouter.ai/models?max_price=0
// and update this list.
const MODEL_CANDIDATES = [
  'nvidia/nemotron-3-super-120b-a12b:free', // tuned for structured output
  'z-ai/glm-4.5-air:free',                  // solid general-purpose free model
  'inclusionai/ling-3.0-flash:free',        // fast, decent instruction-following
  'openrouter/free',                        // last resort: whatever's currently free
];

// The response now mixes a long-form Hebrew design write-up with a JSON
// payload at the end, so we no longer force response_format: json_object
// (that mode requires the ENTIRE completion to be JSON, which would be
// incompatible with the prose sections). Instead we ask the model to wrap
// the JSON in its own fenced code block, which we extract reliably below
// regardless of everything else the model writes around it.
const SYSTEM_PROMPT = `You are RoomAI, a professional interior architect and space planning AI.
Your task is to design the user's room based ONLY on the information the user provides.
Do not invent missing measurements. If important information is missing, clearly state your assumptions before designing.

Your goals:
- Maximize comfort and ergonomics.
- Keep all walkways clear (at least 60cm).
- Respect door and window locations; keep a 90cm clearance in front of every door's swing.
- Do not block doors, windows, or the air conditioner.
- Stay within the user's budget.
- Match the requested design style.

Write your entire response in Hebrew (except the JSON keys and the English image-generation prompt in section 6), using EXACTLY this structure, with each section starting on its own line with a "#" heading:

# 1. חדר שתכננתי עבורך
250–500 words describing the room as if the user just walked into it: the feeling of the room, furniture placement and why, how people move inside it, colors, materials, lighting, storage, decorative elements. Do not mention coordinates or JSON here.

# 2. הסבר הפריסה
Explain in plain language where every furniture item is located and why.

# 3. רשימת קניות
Suggest concrete furniture/product types that fit the room, style and budget. If you cannot verify a real, currently-sold product, describe the type of item and its approximate price range instead of inventing a specific product name or brand.

# 4. פלטת צבעים
List 4–6 colors with their HEX codes and a short Hebrew label for each (e.g. "#E8DCC8 – בז' חמים").

# 5. תוכנית תאורה
Explain lighting placement and type (ambient, task, accent).

# 6. AI Image Prompt
A single English paragraph, suitable as a prompt for an image-generation model, describing what the finished room should look like.

# 7. JSON
Return ONLY a fenced code block, opened with \`\`\`json and closed with \`\`\`, containing a single JSON object and nothing else inside the fences:
{"furniture": [ ... ]}

Rules for the furniture array:
- Coordinate system: (0,0) is the north-west corner of the room. X grows east, Y grows south. All values in centimeters.
- Every item: {"id":"item_1","type":"bed|sofa|desk|wardrobe|table|chair|shelf|nightstand|dresser|rug|other","name":"short Hebrew name","x":number,"y":number,"width":number,"length":number,"rotation":0|90|180|270}
- Return between 4 and 10 items appropriate for the room type, style and budget.
- No overlapping items, no blocking windows with tall furniture.`;

function formatDoors(doors) {
  const WALL_HE = { north: 'צפוני', south: 'דרומי', east: 'מזרחי', west: 'מערבי' };
  const OPEN_HE = {
    'inside-left': 'פנימה, ציר שמאל', 'inside-right': 'פנימה, ציר ימין',
    'outside-left': 'החוצה, ציר שמאל', 'outside-right': 'החוצה, ציר ימין',
    sliding: 'הזזה',
  };
  if (!Array.isArray(doors) || doors.length === 0) return 'לא צוינו דלתות';
  return doors
    .map((d, i) => `${i + 1}. קיר ${WALL_HE[d.wall] || d.wall}, מיקום ${d.x} ס"מ מהפינה, רוחב ${d.width} ס"מ, פתיחה: ${OPEN_HE[d.opens] || d.opens || 'לא צוין'}`)
    .join('\n');
}

function formatWindows(windows) {
  const WALL_HE = { north: 'צפוני', south: 'דרומי', east: 'מזרחי', west: 'מערבי' };
  if (!Array.isArray(windows) || windows.length === 0) return 'לא צוינו חלונות';
  return windows
    .map((w, i) => `${i + 1}. קיר ${WALL_HE[w.wall] || w.wall}, מיקום ${w.x} ס"מ מהפינה, רוחב ${w.width} ס"מ${w.sillHeight ? `, גובה אדן ${w.sillHeight} ס"מ` : ''}`)
    .join('\n');
}

function buildUserPrompt(room) {
  const ROOM_TYPE_HE = {
    bedroom: 'חדר שינה', living: 'סלון', kids: 'חדר ילדים',
    office: 'חדר עבודה / משרד', studio: 'סטודיו', other: 'אחר',
  };

  return `========================
ROOM INFORMATION
========================
Room Type:
${ROOM_TYPE_HE[room.roomType] || room.roomType || 'לא צוין'}

Dimensions:
Length: ${room.roomLength ?? 'לא צוין'} cm
Width: ${room.roomWidth ?? 'לא צוין'} cm
Height: ${room.roomHeight ?? 'לא צוין'} cm

Doors:
${formatDoors(room.doors)}

Windows:
${formatWindows(room.windows)}

Existing Furniture / Must-keep:
${room.keepFurniture || 'לא צוין'}

Budget:
${room.budget ? `${room.budget} ₪` : 'לא צוין'}

Design Style:
${room.style || 'לא צוין'}

Additional Notes:
${room.notes || room.acLocation || room.outlets ? `AC: ${room.acLocation || 'לא צוין'}; Outlets: ${room.outlets || 'לא צוין'}; Notes: ${room.notes || 'אין'}` : 'אין'}
========================`;
}

// Extracts the furniture array from the model's raw completion text.
// Looks first for a fenced \`\`\`json block (what we asked for) — takes the
// LAST one found, in case the model echoes an example earlier. Falls back
// to a bare {...} / [...] scan for models that don't follow fencing.
function extractFurniture(rawText) {
  const text = String(rawText || '');
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];

  const tryParse = (str) => {
    try {
      const parsed = JSON.parse(str.trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.furniture)) return parsed.furniture;
    } catch (err) {
      // ignore
    }
    return null;
  };

  if (fenced.length) {
    const last = fenced[fenced.length - 1][1];
    const result = tryParse(last);
    if (result) return result;
  }

  // Fallback: last {...} blob anywhere in the text.
  const objMatches = [...text.matchAll(/\{[\s\S]*?\}\s*$/gm)];
  const braceBlobs = [...text.matchAll(/\{[\s\S]*\}/g)];
  if (braceBlobs.length) {
    const result = tryParse(braceBlobs[braceBlobs.length - 1][0]);
    if (result) return result;
  }

  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const result = tryParse(arrMatch[0]);
    if (result) return result;
  }

  return null;
}

// Strips the "# 7. JSON" section (and its fenced code block) out of the
// raw text, leaving sections 1-6 as clean Hebrew markdown for display.
function extractReport(rawText) {
  const text = String(rawText || '');
  const cutIndex = text.search(/^#\s*7\b/m);
  const withoutJsonSection = cutIndex === -1 ? text : text.slice(0, cutIndex);
  return withoutJsonSection.trim();
}

const JSON_HEADERS_HELPER = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
};

module.exports = async function handler(req, res) {
  JSON_HEADERS_HELPER(res);

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

    const room = req.body && req.body.room;
    if (!room || typeof room !== 'object') {
      res.status(400).json({ error: 'בקשה לא תקינה' });
      return;
    }

    const userPrompt = buildUserPrompt(room);

    const callModel = (model) =>
      fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://roomai.example.com',
          'X-Title': 'RoomAI',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.6,
          // The write-up (sections 1-6) plus the JSON section needs real
          // room — 1500 tokens was cutting the response off before the
          // JSON block ever appeared, which is one cause of failures.
          max_tokens: 4000,
        }),
      });

    let bestAttempt = null; // { model, rawText, report, furniture }
    let lastHttpError = null;

    for (const model of MODEL_CANDIDATES) {
      let orResponse;
      try {
        orResponse = await callModel(model);
      } catch (networkErr) {
        console.warn(`generate-plan: network error calling ${model}`, networkErr);
        lastHttpError = 'network';
        continue;
      }

      if (!orResponse.ok) {
        const errText = await orResponse.text().catch(() => '');
        console.warn(`generate-plan: ${model} returned ${orResponse.status}`, errText.slice(0, 300));
        lastHttpError = orResponse.status;
        continue; // try the next candidate
      }

      let data;
      try {
        data = await orResponse.json();
      } catch (parseErr) {
        console.warn(`generate-plan: ${model} response was not JSON`, parseErr);
        continue;
      }

      const rawText = data?.choices?.[0]?.message?.content || '';
      const finishReason = data?.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        console.warn(`generate-plan: ${model} completion was truncated (hit max_tokens)`);
      }

      const furniture = extractFurniture(rawText);
      const report = extractReport(rawText);
      const hasUsableReport = report && report.length > 30;

      // Keep the most useful attempt so far, in case every candidate
      // ends up partial and we need to fall back to the best of a bad lot.
      if (!bestAttempt || (furniture && !bestAttempt.furniture) || (hasUsableReport && !bestAttempt.report)) {
        bestAttempt = { model, rawText, report: hasUsableReport ? report : bestAttempt?.report, furniture: furniture || bestAttempt?.furniture };
      }

      if (furniture && hasUsableReport) {
        // Full success — no need to try further candidates.
        res.status(200).json({ report, furniture });
        return;
      }
    }

    // Every candidate was partial or failed outright.
    if (bestAttempt && (bestAttempt.furniture || bestAttempt.report)) {
      console.warn(`generate-plan: falling back to partial result from ${bestAttempt.model}`);
      res.status(200).json({
        report: bestAttempt.report || null,
        furniture: bestAttempt.furniture || [],
        warning: bestAttempt.furniture
          ? 'המודל לא סיפק תיאור מלא, אך הפריסה הדו-ממדית נוצרה בהצלחה.'
          : 'המודל סיפק תיאור אך לא הצליח ליצור תוכנית JSON תקינה לפריסת הרהיטים. נסו שוב — לפעמים ניסיון חוזר עובר על מודל שונה.',
        // Surface the raw text too so you're not left guessing what the
        // model actually said — this is exactly what "no report at all"
        // looked like from the outside; now you can see why.
        debugRaw: bestAttempt.report ? undefined : bestAttempt.rawText.slice(0, 2000),
      });
      return;
    }

    console.error('generate-plan: all model candidates failed', { lastHttpError });
    res.status(502).json({
      error: 'כל המודלים החינמיים הזמינים כרגע נכשלו במענה לבקשה. נסו שוב בעוד רגע (יתכן עומס זמני על השכבה החינמית של OpenRouter).',
    });
  } catch (err) {
    console.error('generate-plan: unexpected error', err);
    res.status(500).json({ error: 'שגיאה לא צפויה בשרת. נסו שוב.' });
  }
};
