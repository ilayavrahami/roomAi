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

  /* ---------------- Generate JSON payload ---------------- */

  document.getElementById('generateBtn').addEventListener('click', () => {
    const s = collectState();

    document.getElementById('reviewActions').hidden = true;
    document.getElementById('generatingBox').hidden = false;

    setTimeout(() => {
      const payload = {
        room: {
          type: s.roomType,
          width: Number(s.roomWidth),
          length: Number(s.roomLength),
          height: Number(s.roomHeight),
        },
        doors: s.doors,
        windows: s.windows,
        constraints: {
          acLocation: s.acLocation || null,
          outlets: s.outlets || null,
          radiator: s.radiator || null,
          keepFurniture: s.keepFurniture || null,
          notes: s.notes || null,
        },
        budget: Number(s.budget),
        stylePreferences: s.style ? [s.style] : [],
      };

      document.getElementById('jsonOutput').value = JSON.stringify(payload, null, 2);
      document.getElementById('generatingBox').hidden = true;
      document.getElementById('resultBox').hidden = false;
      RoomAIUI.toast('חבילת הנתונים מוכנה', 'success');
    }, 700);
  });

  document.getElementById('copyJsonBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('jsonOutput');
    try {
      await navigator.clipboard.writeText(textarea.value);
      RoomAIUI.toast('הועתק ללוח', 'success');
    } catch {
      textarea.select();
      document.execCommand('copy');
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
