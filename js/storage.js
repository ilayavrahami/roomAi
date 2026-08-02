/* =========================================================
   RoomAI — storage.js
   Thin wrapper around localStorage for autosaving wizard state.
========================================================= */

const RoomAIStorage = (() => {
  const KEY = 'roomai_wizard_state_v1';

  function save(state) {
    try {
      const payload = { ...state, _savedAt: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('RoomAI: failed to save state', err);
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('RoomAI: failed to load state', err);
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
      return true;
    } catch (err) {
      console.error('RoomAI: failed to clear state', err);
      return false;
    }
  }

  return { save, load, clear };
})();
