// api/generate-plan.js  (Vercel Serverless Function)
//
// Server-side proxy: receives room data from the browser and calls
// OpenRouter (free models) to generate a room layout.
//
// ARCHITECTURE NOTE (rewritten after repeated timeouts):
// Earlier versions asked ONE model call to produce both a long Hebrew
// design write-up AND the furniture JSON in a single ~4000-token
// completion. Free-tier OpenRouter models are slow and unpredictable —
// OpenRouter's own docs recommend 120s+ client timeouts for them — so a
// single big request kept getting killed by our own timeout before
// finishing, which looked like "everything failed" even though nothing
// was actually broken.
//
// Fix: split into two SMALLER, INDEPENDENT requests:
//   1. "layout" — ONLY the furniture JSON (~900 tokens). This is the
//      thing you actually asked for (the 2D drawing data), so it's
//      requested first, with strict JSON mode, and is fast because it's
//      a small ask.
//   2. "report" — ONLY the descriptive write-up (~1800 tokens), no JSON
//      involved. Best-effort: if this fails, you still get your 2D plan.
// Both run in parallel across a few free-model candidates each, with
// generous (but bounded) per-call timeouts, so one slow/dead model can't
// sink the whole request — and the critical layout no longer has to
// compete with the write-up for time or token budget.
//
// The OpenRouter API key lives ONLY in the Vercel environment variable
// OPENROUTER_API_KEY — it is never sent to, or visible from, the browser.
//
// Every code path sends a proper JSON response via res.status().json().
// The whole handler is wrapped in one outer try/catch so an unexpected
// error can never bubble up as a raw error page.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free, non-OpenAI models — verified live on openrouter.ai/models
// (Price: Free) as of Aug 2, 2026. Free model IDs on OpenRouter churn
// every few weeks; if these start returning http_404 in the logs, check
// https://openrouter.ai/models?max_price=0 and update this list.
const MODEL_CANDIDATES = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'inclusionai/ling-3.0-flash:free',
];

// Free-tier inference is genuinely slow, especially for the bigger
// models. OpenRouter's own guidance is 120s+ client timeouts. We give
// the CRITICAL layout call more time than the report call, since it's
// small (~900 tokens) and worth waiting for; the report is best-effort.
const LAYOUT_TIMEOUT_MS = 60000;
const REPORT_TIMEOUT_MS = 90000;

const LAYOUT_SYSTEM_PROMPT = `You are RoomAI, a professional interior architect and space-planning AI.
Design furniture placement for the user's room based ONLY on the information given. Do not invent missing measurements.

Rules:
- Maximize comfort and ergonomics. Keep all walkways clear (at least 60cm).
- Respect door and window locations; keep a 90cm clearance in front of every door's swing.
- Do not block doors, windows, or the air conditioner. No overlapping items.
- Stay within budget and match the requested style.
- Coordinate system: (0,0) is the north-west corner of the room. X grows east, Y grows south. All values in centimeters.

Respond with ONLY a single JSON object, nothing else — no explanation, no markdown fences:
{"furniture": [{"id":"item_1","type":"bed|sofa|desk|wardrobe|table|chair|shelf|nightstand|dresser|rug|other","name":"short Hebrew name","x":number,"y":number,"width":number,"length":number,"rotation":0|90|180|270}]}
Return between 4 and 10 items appropriate for the room type, style and budget.`;

const REPORT_SYSTEM_PROMPT = `You are RoomAI, a professional interior architect writing a short client-facing design summary in Hebrew, based ONLY on the information given. Do not invent missing measurements.

Write your entire response in Hebrew (except the JSON... there is no JSON here — and except the English image prompt in section 5), using EXACTLY this structure, each section starting on its own line with a "#" heading. Keep it concise — this is a summary, not an essay:

# 1. חדר שתכננתי עבורך
120–200 words describing the room as if the user just walked into it: the feeling, furniture placement and why, colors, materials, lighting. Do not mention coordinates or JSON.

# 2. רשימת קניות
3-5 concrete furniture/product types fitting the room, style and budget. If you cannot verify a real, currently-sold product, describe the type and approximate price range instead of inventing a brand.

# 3. פלטת צבעים
4–6 colors with HEX codes and a short Hebrew label each (e.g. "#E8DCC8 – בז' חמים").

# 4. תוכנית תאורה
2-3 sentences on lighting placement and type (ambient, task, accent).

# 5. AI Image Prompt
A single English paragraph (60-100 words) for an image-generation model (Pollinations.ai / Flux), describing what the finished room should look like — as a photorealistic interior photo, not a floor plan or diagram.
Include: room type, design style, 2-4 key furniture pieces, color palette, lighting mood, materials.
CRITICAL: you are given the room's width/length/height in centimeters in the ROOM INFORMATION above — translate that into a visual size descriptor in the prompt. Use the floor area (width × length) as a guide:
- Under ~9 m² (e.g. a small room): use phrases like "cozy compact layout", "small intimate room".
- ~9–20 m²: use phrases like "comfortably sized room", "well-proportioned layout".
- Over ~20 m²: use phrases like "spacious open layout", "airy expansive room".
Do not just restate the numbers — express the scale in descriptive visual language a photographer/artist would use.`;

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

// Extracts the furniture array from a completion. Handles: a clean JSON
// object (expected, since the layout call uses response_format), a
// fenced ```json block, or a bare {...}/[...] blob as last resort.
function extractFurniture(rawText) {
  const text = String(rawText || '').trim();

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

  // Most likely case: the whole response IS the JSON object.
  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fenced.length) {
    const result = tryParse(fenced[fenced.length - 1][1]);
    if (result) return result;
  }

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

function isUsableReport(text) {
  return !!(text && text.trim().length > 30);
}

// Pulls the "# 5. AI Image Prompt" section's body out of the report text.
function extractImagePrompt(report) {
  if (!report) return null;
  const lines = report.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => /^#\s*5\b/.test(l.trim()) || /image prompt/i.test(l));
  if (headingIdx === -1) return null;
  const body = lines.slice(headingIdx + 1).join('\n').trim();
  return body.length > 15 ? body : null;
}

// Deterministic fallback if the model didn't produce a usable image
// prompt (or failed the report call entirely) — still satisfies the
// "must reflect room size" requirement even without the LLM's help,
// so image generation never silently just doesn't happen.
function buildFallbackImagePrompt(room) {
  const ROOM_TYPE_EN = {
    bedroom: 'bedroom', living: 'living room', kids: "kids' room",
    office: 'home office', studio: 'studio apartment', other: 'room',
  };
  const roomType = ROOM_TYPE_EN[room.roomType] || 'room';
  const style = room.style || 'modern';

  const w = Number(room.roomWidth) || 0;
  const l = Number(room.roomLength) || 0;
  const areaM2 = (w * l) / 10000; // cm² -> m²
  let sizeDescriptor = 'well-proportioned layout';
  if (areaM2 && areaM2 < 9) sizeDescriptor = 'cozy compact layout, small intimate room';
  else if (areaM2 && areaM2 > 20) sizeDescriptor = 'spacious open layout, airy expansive room';

  return `A photorealistic interior photo of a ${style} style ${roomType}, ${sizeDescriptor}, natural lighting, tasteful furniture arrangement, high quality architectural photography.`;
}

async function callOpenRouter({ model, apiKey, systemPrompt, userPrompt, maxTokens, timeoutMs, jsonMode }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: maxTokens,
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const orResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://roomai.example.com',
        'X-Title': 'RoomAI',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!orResponse.ok) {
      const errText = await orResponse.text().catch(() => '');
      return { model, ok: false, reason: `http_${orResponse.status}`, detail: errText.slice(0, 300) };
    }

    let data;
    try {
      data = await orResponse.json();
    } catch (parseErr) {
      return { model, ok: false, reason: 'bad_json_from_provider' };
    }

    const rawText = data?.choices?.[0]?.message?.content || '';
    if (data?.choices?.[0]?.finish_reason === 'length') {
      console.warn(`generate-plan: ${model} completion was truncated (hit max_tokens)`);
    }

    return { model, ok: true, rawText };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return { model, ok: false, reason: timedOut ? 'timeout' : 'network_error', detail: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Runs `attempt` against every candidate in parallel and returns the
// first successful (ok:true) result in MODEL_CANDIDATES priority order —
// not arrival order, so behavior stays predictable. Also returns all
// raw results for logging when everything fails.
async function raceCandidates(candidates, attempt) {
  const settled = await Promise.allSettled(candidates.map(attempt));
  const results = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : { ok: false, reason: 'unexpected_rejection', detail: String(s.reason) }
  );
  const success = results.find((r) => r.ok);
  return { success, results };
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

    // Layout (critical) and report (best-effort) run fully in parallel —
    // one being slow or failing never blocks or delays the other.
    const [layoutOutcome, reportOutcome] = await Promise.all([
      raceCandidates(MODEL_CANDIDATES, (model) =>
        callOpenRouter({
          model, apiKey, userPrompt,
          systemPrompt: LAYOUT_SYSTEM_PROMPT,
          maxTokens: 900,
          timeoutMs: LAYOUT_TIMEOUT_MS,
          jsonMode: true,
        })
      ),
      raceCandidates(MODEL_CANDIDATES, (model) =>
        callOpenRouter({
          model, apiKey, userPrompt,
          systemPrompt: REPORT_SYSTEM_PROMPT,
          maxTokens: 1800,
          timeoutMs: REPORT_TIMEOUT_MS,
          jsonMode: false,
        })
      ),
    ]);

    const furniture = layoutOutcome.success ? extractFurniture(layoutOutcome.success.rawText) : null;
    const report = reportOutcome.success && isUsableReport(reportOutcome.success.rawText)
      ? reportOutcome.success.rawText.trim()
      : null;
    // Always produce SOME image prompt once we have a room to describe —
    // prefer the model's (size-aware, per the system prompt), fall back
    // to a deterministic one computed from the actual dimensions.
    const imagePrompt = extractImagePrompt(report) || buildFallbackImagePrompt(room);

    if (!furniture && !layoutOutcome.success) {
      console.error('generate-plan: layout call failed on all candidates', layoutOutcome.results.map((r) => ({ model: r.model, reason: r.reason })));
    }
    if (!report && !reportOutcome.success) {
      console.warn('generate-plan: report call failed on all candidates', reportOutcome.results.map((r) => ({ model: r.model, reason: r.reason })));
    }

    if (furniture) {
      // Success on the thing that actually matters. Attach the report if
      // we got a usable one; otherwise attach a small non-blocking note.
      const payload = { report, furniture, imagePrompt };
      if (!report) {
        payload.warning = 'הפריסה הדו-ממדית נוצרה בהצלחה. התיאור המילולי לא היה זמין הפעם (לא חובה לצורך הציור).';
      }
      res.status(200).json(payload);
      return;
    }

    // Layout failed on every candidate. If we at least got a report,
    // surface that plus a clear explanation — otherwise raw debug text
    // from whichever layout attempt got furthest, plus a real error.
    if (report) {
      res.status(200).json({
        report,
        furniture: [],
        imagePrompt,
        warning: 'המודל כתב תיאור אך לא הצליח הפעם ליצור פריסת רהיטים תקינה — לכן אין ציור דו-ממדי בניסיון הזה. נסו "צור מחדש".',
      });
      return;
    }

    const anyTimeout = layoutOutcome.results.some((r) => r.reason === 'timeout');
    const bestRaw = layoutOutcome.results.find((r) => r.ok && r.rawText)?.rawText;
    console.error('generate-plan: total failure', {
      layout: layoutOutcome.results.map((r) => ({ model: r.model, reason: r.reason })),
      report: reportOutcome.results.map((r) => ({ model: r.model, reason: r.reason })),
    });
    res.status(502).json({
      error: anyTimeout
        ? 'המודלים החינמיים הזמינים כרגע איטיים מדי ולא הגיבו בזמן. נסו "צור מחדש" — לרוב זה עובד בניסיון נוסף.'
        : 'כל המודלים החינמיים הזמינים כרגע נכשלו במענה לבקשה. נסו שוב בעוד רגע.',
      debugRaw: bestRaw ? bestRaw.slice(0, 1000) : undefined,
      imagePrompt, // deterministic fallback still works even here
    });
  } catch (err) {
    console.error('generate-plan: unexpected error', err);
    res.status(500).json({ error: 'שגיאה לא צפויה בשרת. נסו שוב.' });
  }
};

// Vercel Hobby (with Fluid Compute, which is on by default) allows up to
// 300s — we ask for 120s, comfortably above LAYOUT_TIMEOUT_MS +
// REPORT_TIMEOUT_MS running in parallel (bounded by the slower one,
// ~90s) plus overhead.
module.exports.config = { maxDuration: 120 };
