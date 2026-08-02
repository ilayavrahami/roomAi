/* =========================================================
   RoomAI — wizard.js
   Multi-step wizard: navigation, repeatable fields, autosave,
   review summary and JSON payload generation.
========================================================= */

(function () {
  const form = document.getElementById('wizardForm');
  if (!form) return; // not on the planner page

  const steps = Array.from(document.querySelectorAll('.step-panel'));
  const progressWrap = document.getElementById('progressWrap');
  const styleGrid = document.getElementById('styleGrid');
  const styleError = document.getElementById('styleError');

  let current = 0;
  let doorCount = 0;
  let windowCount = 0;

  const ROOM_TYPE_LABELS = {
    bedroom: 'חדר שינה', living: 'סלון', kids: 'חדר ילדים',
    office: 'חדר עבודה / משרד', studio: 'סטודיו', other: 'אחר',
  };

  const WALL_LABELS = { north: 'צפון', south: 'דרום', east: 'מזרח', west: 'מערב' };

  /* ---------------- Repeatable doors / windows ---------------- */

  function addDoor(prefill) {
    doorCount += 1;
    const id = `door_${doorCount}`;
    const wrap = document.createElement('div');
    wrap.className = 'repeat-item';
    wrap.dataset.id = id;
    wrap.innerHTML = `
      <button type="button" class="remove-btn" data-remove>הסר</button>
      <div class="field-grid">
        <div class="field">
          <label>קיר</label>
          <select data-key="wall">
            <option value="north">צפון</option>
            <option value="south">דרום</option>
            <option value="east">מזרח</option>
            <option value="west">מערב</option>
          </select>
        </div>
        <div class="field">
          <label>מיקום מהפינה (ס"מ)</label>
          <input type="number" data-key="x" min="0" max="1500" value="0">
        </div>
        <div class="field">
          <label>רוחב הדלת (ס"מ)</label>
          <input type="number" data-key="width" min="50" max="200" value="90">
        </div>
        <div class="field">
          <label>כיוון פתיחה</label>
          <select data-key="opens">
            <option value="inside-left">פנימה - שמאלה</option>
            <option value="inside-right">פנימה - ימינה</option>
            <option value="outside-left">החוצה - שמאלה</option>
            <option value="outside-right">החוצה - ימינה</option>
            <option value="sliding">הזזה</option>
          </select>
        </div>
      </div>`;
    applyPrefill(wrap, prefill);
    document.getElementById('doorsList').appendChild(wrap);
    wrap.querySelector('[data-remove]').addEventListener('click', () => { wrap.remove(); autosave(); });
    wrap.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', autosave));
  }

  function addWindow(prefill) {
    windowCount += 1;
    const id = `window_${windowCount}`;
    const wrap = document.createElement('div');
    wrap.className = 'repeat-item';
    wrap.dataset.id = id;
    wrap.innerHTML = `
      <button type="button" class="remove-btn" data-remove>הסר</button>
      <div class="field-grid">
        <div class="field">
          <label>קיר</label>
          <select data-key="wall">
            <option value="north">צפון</option>
            <option value="south">דרום</option>
            <option value="east">מזרח</option>
            <option value="west">מערב</option>
          </select>
        </div>
        <div class="field">
          <label>מיקום מהפינה (ס"מ)</label>
          <input type="number" data-key="x" min="0" max="1500" value="0">
        </div>
        <div class="field">
          <label>רוחב החלון (ס"מ)</label>
          <input type="number" data-key="width" min="30" max="400" value="140">
        </div>
        <div class="field">
          <label>גובה אדן החלון (ס"מ)</label>
          <input type="number" data-key="sillHeight" min="0" max="200" value="90">
        </div>
      </div>`;
    applyPrefill(wrap, prefill);
    document.getElementById('windowsList').appendChild(wrap);
    wrap.querySelector('[data-remove]').addEventListener('click', () => { wrap.remove(); autosave(); });
    wrap.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', autosave));
  }

  function applyPrefill(wrap, data) {
    if (!data) return;
    Object.entries(data).forEach(([key, value]) => {
      const el = wrap.querySelector(`[data-key="${key}"]`);
      if (el) el.value = value;
    });
  }

  function readRepeatList(listId) {
    return Array.from(document.getElementById(listId).children).map((wrap) => {
      const obj = {};
      wrap.querySelectorAll('[data-key]').forEach((el) => {
        obj[el.dataset.key] = el.type === 'number' ? Number(el.value) : el.value;
      });
      return obj;
    });
  }

  document.getElementById('addDoorBtn').addEventListener('click', () => { addDoor(); autosave(); });
  document.getElementById('addWindowBtn').addEventListener('click', () => { addWindow(); autosave(); });

  /* ---------------- Budget slider ---------------- */

  const budgetRange = document.getElementById('budgetRange');
  const budgetDisplay = document.getElementById('budgetDisplay');
  budgetRange.addEventListener('input', () => {
    budgetDisplay.textContent = Number(budgetRange.value).toLocaleString('he-IL');
    autosave();
  });

  /* ---------------- Style picker ---------------- */

  RoomAIUI.initStyleGrid(styleGrid);
  styleGrid.addEventListener('stylechange', () => {
    styleError.textContent = '';
    autosave();
  });

  /* ---------------- Step navigation ---------------- */

  function showStep(index) {
    steps.forEach((s, i) => { s.hidden = i !== index; });
    RoomAIUI.renderProgress(progressWrap, index);
    current = index;
    if (index === steps.length - 1) buildSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goNext() {
    const stepEl = steps[current];

    if (!RoomAIValidation.validateStep(stepEl)) {
      RoomAIUI.toast('נא למלא את כל השדות המסומנים', 'error');
      return;
    }

    // Step 2 (doors/windows): require at least one door.
    if (current === 1 && document.getElementById('doorsList').children.length === 0) {
      RoomAIUI.toast('נא להוסיף לפחות דלת אחת', 'error');
      return;
    }

    // Step 3 (style): require a style selection.
    if (current === 2 && !RoomAIValidation.validateStyleSelected(styleGrid)) {
      styleError.textContent = 'נא לבחור סגנון עיצוב אחד לפחות';
      RoomAIUI.toast('נא לבחור סגנון עיצוב', 'error');
      return;
    }

    if (current < steps.length - 1) showStep(current + 1);
  }

  function goPrev() {
    if (current > 0) showStep(current - 1);
  }

  document.querySelectorAll('[data-next]').forEach((btn) => btn.addEventListener('click', goNext));
  document.querySelectorAll('[data-prev]').forEach((btn) => btn.addEventListener('click', goPrev));

  /* ---------------- Autosave ---------------- */

  let autosaveTimer = null;
  function autosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      RoomAIStorage.save(collectState());
    }, 300);
  }

  form.addEventListener('input', autosave);

  function collectState() {
    return {
      currentStep: current,
      roomType: form.roomType.value,
      roomWidth: form.roomWidth.value,
      roomLength: form.roomLength.value,
      roomHeight: form.roomHeight.value,
      doors: readRepeatList('doorsList'),
      windows: readRepeatList('windowsList'),
      budget: budgetRange.value,
      style: styleGrid.querySelector('.style-card.selected')?.dataset.style || '',
      acLocation: form.acLocation.value,
      outlets: form.outlets.value,
      radiator: form.radiator.value,
      keepFurniture: form.keepFurniture.value,
      notes: form.notes.value,
    };
  }

  function restoreState() {
    const state = RoomAIStorage.load();
    if (!state) { addDoor(); addWindow(); return; }

    form.roomType.value = state.roomType || '';
    form.roomWidth.value = state.roomWidth || '';
    form.roomLength.value = state.roomLength || '';
    form.roomHeight.value = state.roomHeight || 270;

    (state.doors && state.doors.length ? state.doors : [null]).forEach((d) => addDoor(d));
    (state.windows && state.windows.length ? state.windows : [null]).forEach((w) => addWindow(w));

    if (state.budget) {
      budgetRange.value = state.budget;
      budgetDisplay.textContent = Number(state.budget).toLocaleString('he-IL');
    }

    if (state.style) {
      const card = styleGrid.querySelector(`[data-style="${state.style}"]`);
      if (card) card.classList.add('selected');
    }

    form.acLocation.value = state.acLocation || '';
    form.outlets.value = state.outlets || '';
    form.radiator.value = state.radiator || '';
    form.keepFurniture.value = state.keepFurniture || '';
    form.notes.value = state.notes || '';

    if (typeof state.currentStep === 'number' && state.currentStep >= 0 && state.currentStep < steps.length) {
      showStep(state.currentStep);
    }
  }

  /* ---------------- Review summary ---------------- */

  function buildSummary() {
    const s = collectState();
    const grid = document.getElementById('summaryGrid');
    const warning = document.getElementById('summaryWarning');

    grid.innerHTML = `
      <div class="summary-box"><h4>סוג חדר</h4><p>${ROOM_TYPE_LABELS[s.roomType] || '—'}</p></div>
      <div class="summary-box"><h4>מידות</h4><p>${s.roomWidth || '—'} × ${s.roomLength || '—'} ס"מ, גובה ${s.roomHeight || '—'} ס"מ</p></div>
      <div class="summary-box"><h4>דלתות / חלונות</h4><p>${s.doors.length} דלתות, ${s.windows.length} חלונות</p></div>
      <div class="summary-box"><h4>תקציב</h4><p>${Number(s.budget).toLocaleString('he-IL')} ₪</p></div>
      <div class="summary-box"><h4>סגנון</h4><p>${s.style || '—'}</p></div>
      <div class="summary-box"><h4>רהיטים להשארה</h4><p>${s.keepFurniture ? s.keepFurniture : 'לא צוין'}</p></div>
    `;

    const missing = [];
    if (!s.acLocation) missing.push('מיקום מזגן');
    if (!s.outlets) missing.push('שקעי חשמל');

    if (missing.length) {
      warning.hidden = false;
      warning.textContent = `שימו לב: לא צוינו — ${missing.join(', ')}. ניתן להמשיך, והתכנון יניח הנחות סבירות במקומם.`;
    } else {
      warning.hidden = true;
    }
  }

  /* ---------------- 2D rendering helpers (same approach as planner-2d.html) ---------------- */

  const FURNITURE_COLORS = {
    bed:'#f59e0b', sofa:'#2563eb', desk:'#16a34a', wardrobe:'#7c3aed',
    table:'#0d9488', chair:'#64748b', shelf:'#c026d3', nightstand:'#ea580c',
    dresser:'#0369a1', rug:'#a3a3a3', other:'#475569'
  };

  function colorFor(type) {
    const t = (type || '').toLowerCase();
    for (const key in FURNITURE_COLORS) { if (t.includes(key)) return FURNITURE_COLORS[key]; }
    return FURNITURE_COLORS.other;
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
  }

  function wallSegment(wall, x, width, room) {
    if (wall === 'north') return { a:{x:x,y:0}, b:{x:x+width,y:0} };
    if (wall === 'south') return { a:{x:x,y:room.roomLength}, b:{x:x+width,y:room.roomLength} };
    if (wall === 'west')  return { a:{x:0,y:x}, b:{x:0,y:x+width} };
    return { a:{x:room.roomWidth,y:x}, b:{x:room.roomWidth,y:x+width} }; // east
  }

  function doorGeometry(door, room) {
    const seg = wallSegment(door.wall, door.x, door.width, room);
    const gapStart = seg.a, gapEnd = seg.b;

    let intoRoom;
    if (door.wall === 'north') intoRoom = {x:0,y:1};
    else if (door.wall === 'south') intoRoom = {x:0,y:-1};
    else if (door.wall === 'west') intoRoom = {x:1,y:0};
    else intoRoom = {x:-1,y:0};

    if (door.opens === 'sliding') return { gapStart, gapEnd };

    const isLeft = (door.opens || '').includes('left');
    const hinge = isLeft ? gapStart : gapEnd;
    const closedPoint = isLeft ? gapEnd : gapStart;
    const isOutside = (door.opens || '').includes('outside');
    const dir = isOutside ? {x:-intoRoom.x,y:-intoRoom.y} : intoRoom;
    const openPoint = { x: hinge.x + dir.x*door.width, y: hinge.y + dir.y*door.width };
    const sweep = isLeft ? 1 : 0;

    return { gapStart, gapEnd, hinge, closedPoint, openPoint, sweep };
  }

  function renderPlan(room, furniture) {
    const PAD = 40, MAXW = 780, MAXH = 560;
    const scale = Math.min((MAXW-2*PAD)/room.roomWidth, (MAXH-2*PAD)/room.roomLength);
    const W = room.roomWidth*scale, H = room.roomLength*scale;
    const ox = PAD, oy = PAD;
    const toX = cm => ox + cm*scale;
    const toY = cm => oy + cm*scale;

    let svg = `<svg viewBox="0 0 ${W+2*PAD} ${H+2*PAD}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="#ffffff" stroke="#0f172a" stroke-width="4"/>`;

    (room.doors||[]).forEach(d => {
      const geo = doorGeometry(d, room);
      if (!geo) return;
      const gs = geo.gapStart, ge = geo.gapEnd;
      svg += `<line x1="${toX(gs.x)}" y1="${toY(gs.y)}" x2="${toX(ge.x)}" y2="${toY(ge.y)}" stroke="#ffffff" stroke-width="6"/>`;
      if (geo.openPoint) {
        svg += `<line x1="${toX(geo.hinge.x)}" y1="${toY(geo.hinge.y)}" x2="${toX(geo.openPoint.x)}" y2="${toY(geo.openPoint.y)}" stroke="#2563eb" stroke-width="2"/>`;
        svg += `<path d="M ${toX(geo.closedPoint.x)} ${toY(geo.closedPoint.y)} A ${d.width*scale} ${d.width*scale} 0 0 ${geo.sweep} ${toX(geo.openPoint.x)} ${toY(geo.openPoint.y)}" fill="none" stroke="#93c5fd" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      } else {
        svg += `<line x1="${toX(gs.x)}" y1="${toY(gs.y)}" x2="${toX(ge.x)}" y2="${toY(ge.y)}" stroke="#2563eb" stroke-width="3" stroke-dasharray="6 4"/>`;
      }
    });

    (room.windows||[]).forEach(w => {
      const geo = wallSegment(w.wall, w.x, w.width, room);
      svg += `<line x1="${toX(geo.a.x)}" y1="${toY(geo.a.y)}" x2="${toX(geo.b.x)}" y2="${toY(geo.b.y)}" stroke="#38bdf8" stroke-width="7"/>`;
    });

    (furniture||[]).forEach(f => {
      const x = toX(f.x), y = toY(f.y), w = f.width*scale, h = f.length*scale;
      const cx = x + w/2, cy = y + h/2;
      const rot = f.rotation || 0;
      const col = colorFor(f.type);
      svg += `<g transform="rotate(${rot} ${cx} ${cy})">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${col}22" stroke="${col}" stroke-width="2"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${col}" font-weight="700">${escapeXml(f.name||f.type||'')}</text>
      </g>`;
    });

    svg += `</svg>`;
    return svg;
  }

  /* ---------------- Report rendering (sections 1-6 from the model) ---------------- */

  function splitSections(report) {
    const lines = String(report || '').split(/\r?\n/);
    const sections = [];
    let curr = null;
    lines.forEach(line => {
      const m = line.match(/^#\s*\d*\.?\s*(.+)$/);
      if (m) {
        if (curr) sections.push(curr);
        curr = { title: m[1].trim(), body: [] };
      } else if (curr) {
        curr.body.push(line);
      }
    });
    if (curr) sections.push(curr);
    return sections.map(s => ({ title: s.title, body: s.body.join('\n').trim() }));
  }

  function renderSectionBody(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let html = '', inList = false;
    lines.forEach(line => {
      if (/^[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${escapeXml(line.replace(/^[-*]\s+/, ''))}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<p>${escapeXml(line)}</p>`;
      }
    });
    if (inList) html += '</ul>';
    return html;
  }

  function renderReport(report) {
    const sections = splitSections(report);
    if (!sections.length) {
      // The model wrote something, just not with our "# 1. ..." headers —
      // show it as-is rather than throwing away real content.
      return `<div class="report-section"><p style="color:var(--muted); margin-bottom:10px;">המודל לא עקב אחרי מבנה הסעיפים המבוקש, אז הנה התשובה כפי שהתקבלה:</p>${renderSectionBody(report)}</div>`;
    }
    return sections.map(s => {
      const isColor = /פלטת צבעים|color palette/i.test(s.title);
      const isImagePrompt = /image prompt|פרומפט תמונה/i.test(s.title);

      if (isImagePrompt) {
        return `<div class="report-section"><h3>${escapeXml(s.title)}</h3><pre class="image-prompt">${escapeXml(s.body)}</pre></div>`;
      }

      let swatches = '';
      if (isColor) {
        const hexes = [...new Set((s.body.match(/#[0-9a-fA-F]{6}/g) || []))];
        if (hexes.length) {
          swatches = `<div class="swatches">${hexes.map(h => `<span class="swatch" style="background:${h}" title="${h}"></span>`).join('')}</div>`;
        }
      }

      return `<div class="report-section"><h3>${escapeXml(s.title)}</h3>${swatches}${renderSectionBody(s.body)}</div>`;
    }).join('');
  }

  /* ---------------- AI image (Pollinations.ai) ---------------- */

  function showAiImage(imagePrompt) {
    if (!imagePrompt) return;
    const section = document.getElementById('imageSection');
    const img = document.getElementById('aiImage');
    const loading = document.getElementById('imageLoading');
    const errBox = document.getElementById('imageError');

    section.hidden = false;
    img.style.display = 'none';
    errBox.style.display = 'none';
    loading.style.display = 'flex';

    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=1024&model=flux`;

    img.onload = () => { loading.style.display = 'none'; img.style.display = 'block'; };
    img.onerror = () => { loading.style.display = 'none'; errBox.style.display = 'block'; };
    img.src = url;
  }

  /* ---------------- Generate with AI ---------------- */

  async function runGeneration() {
    const s = collectState();

    document.getElementById('errorBox').hidden = true;
    document.getElementById('resultBox').hidden = true;
    document.getElementById('warnBanner').hidden = true;
    document.getElementById('imageSection').hidden = true;
    document.getElementById('reviewActions').hidden = true;
    document.getElementById('generatingBox').hidden = false;

    try {
      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: s }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        console.error('generate-plan: non-JSON response', response.status, text.slice(0, 300));
        throw new Error(
          response.status === 404
            ? 'פונקציית השרת לא נמצאה (404). ודאו שהאתר פרוס ב-Vercel וש-api/generate-plan.js קיים בפריסה.'
            : `השרת החזיר תגובה לא צפויה (סטטוס ${response.status}).`
        );
      }

      const data = await response.json();
      if (!response.ok) {
        if (data.debugRaw) {
          document.getElementById('reportContent').innerHTML =
            `<div class="report-section"><h3>תשובה גולמית מהמודל (לצורך דיבוג)</h3>
             <pre class="image-prompt">${escapeXml(data.debugRaw)}</pre></div>`;
          document.getElementById('planSection').hidden = true;
          document.getElementById('resultBox').hidden = false;
        }
        if (data.imagePrompt) showAiImage(data.imagePrompt);
        throw new Error(data.error || `שגיאת שרת (${response.status})`);
      }

      if (data.warning) {
        const banner = document.getElementById('warnBanner');
        banner.textContent = data.warning;
        banner.hidden = false;
      }

      if (data.debugRaw) {
        document.getElementById('reportContent').innerHTML =
          `<div class="report-section"><h3>תשובה גולמית מהמודל</h3>
           <p style="color:var(--muted);">לא הצלחנו לפרש את התשובה למבנה הצפוי, אז הנה מה שהמודל החזיר בפועל:</p>
           <pre class="image-prompt">${escapeXml(data.debugRaw)}</pre></div>`;
      } else if (data.report) {
        document.getElementById('reportContent').innerHTML = renderReport(data.report);
      } else {
        document.getElementById('reportContent').innerHTML = '';
      }

      if (data.imagePrompt) showAiImage(data.imagePrompt);

      const furniture = Array.isArray(data.furniture) ? data.furniture : [];
      const planSection = document.getElementById('planSection');
      if (furniture.length) {
        document.getElementById('planWrap').innerHTML = renderPlan(s, furniture);
        document.getElementById('rawJson').textContent = JSON.stringify(furniture, null, 2);

        const usedTypes = [...new Set(furniture.map(f => (f.type||'other').toLowerCase()))];
        document.getElementById('legend').innerHTML = usedTypes.map(t =>
          `<div><span class="sw" style="background:${colorFor(t)}"></span>${t}</div>`
        ).join('') + `<div><span class="sw" style="background:#38bdf8"></span>חלון</div><div><span class="sw" style="background:#2563eb"></span>דלת</div>`;

        document.getElementById('furnitureList').innerHTML = furniture.map(f =>
          `<div class="f-item"><b>${escapeXml(f.name||f.type)}</b>${f.width}×${f.length} ס"מ · סיבוב ${f.rotation||0}°</div>`
        ).join('');
        planSection.hidden = false;
      } else {
        planSection.hidden = true;
        document.getElementById('rawJson').textContent = '';
      }

      if (!data.report && !data.debugRaw && furniture.length === 0) {
        throw new Error('לא התקבל תוכן שמיש מהמודל. נסו שוב.');
      }

      document.getElementById('resultBox').hidden = false;
      RoomAIUI.toast('התכנון מוכן', 'success');
    } catch (err) {
      console.error(err);
      const box = document.getElementById('errorBox');
      box.textContent = 'אירעה שגיאה ביצירת התכנון: ' + err.message;
      box.hidden = false;
      document.getElementById('reviewActions').hidden = false;
      RoomAIUI.toast('אירעה שגיאה', 'error');
    } finally {
      document.getElementById('generatingBox').hidden = true;
    }
  }

  document.getElementById('generateBtn').addEventListener('click', runGeneration);
  document.getElementById('regenerateBtn').addEventListener('click', runGeneration);

  document.getElementById('copyJsonBtn').addEventListener('click', async () => {
    const text = document.getElementById('rawJson').textContent;
    if (!text) { RoomAIUI.toast('אין עדיין JSON להעתקה', 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
      RoomAIUI.toast('הועתק ללוח', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      RoomAIUI.toast('הועתק ללוח', 'success');
    }
  });

  document.getElementById('startOverBtn').addEventListener('click', () => {
    RoomAIStorage.clear();
    window.location.reload();
  });

  /* ---------------- Init ---------------- */

  restoreState();
  showStep(current);
})();
