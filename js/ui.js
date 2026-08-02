/* =========================================================
   RoomAI — ui.js
   Reusable UI widgets: toasts, progress bar, style-card picker.
========================================================= */

const RoomAIUI = (() => {

  function toastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type = '') {
    const stack = toastStack();
    const el = document.createElement('div');
    el.className = `toast ${type}`.trim();
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // Renders the progress bar fill + step dots for a given current step index (0-based).
  function renderProgress(progressWrapEl, currentIndex) {
    const steps = progressWrapEl.querySelectorAll('.progress-step');
    const fill = progressWrapEl.querySelector('.progress-fill');

    steps.forEach((stepEl, i) => {
      stepEl.classList.remove('active', 'done');
      if (i < currentIndex) stepEl.classList.add('done');
      if (i === currentIndex) stepEl.classList.add('active');
    });

    if (fill && steps.length > 1) {
      const pct = (currentIndex / (steps.length - 1)) * 100;
      fill.style.width = `${pct}%`;
    }
  }

  // Wires up a .style-grid of .style-card elements to single-select behavior.
  function initStyleGrid(gridEl) {
    gridEl.querySelectorAll('.style-card').forEach((card) => {
      card.addEventListener('click', () => {
        gridEl.querySelectorAll('.style-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        gridEl.dispatchEvent(new CustomEvent('stylechange', { detail: card.dataset.style }));
      });
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  return { toast, renderProgress, initStyleGrid };
})();
