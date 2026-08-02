/* =========================================================
   RoomAI — validation.js
   Per-step validation rules for the wizard.
========================================================= */

const RoomAIValidation = (() => {

  function markInvalid(fieldEl, message) {
    fieldEl.classList.add('invalid');
    const msgEl = fieldEl.querySelector('.error-msg');
    if (msgEl && message) msgEl.textContent = message;
  }

  function clearInvalid(fieldEl) {
    fieldEl.classList.remove('invalid');
  }

  // Validates every .field inside a step panel that has [data-required] or
  // [data-min]/[data-max] attributes on its input/select/textarea.
  function validateStep(stepEl) {
    let valid = true;
    const fields = stepEl.querySelectorAll('.field');

    fields.forEach((fieldEl) => {
      const input = fieldEl.querySelector('input, select, textarea');
      if (!input) return;

      clearInvalid(fieldEl);

      const required = input.hasAttribute('data-required');
      const value = input.value.trim();

      if (required && !value) {
        markInvalid(fieldEl, 'שדה חובה');
        valid = false;
        return;
      }

      if (value && input.type === 'number') {
        const num = Number(value);
        const min = input.hasAttribute('min') ? Number(input.min) : null;
        const max = input.hasAttribute('max') ? Number(input.max) : null;

        if (Number.isNaN(num)) {
          markInvalid(fieldEl, 'יש להזין מספר תקין');
          valid = false;
          return;
        }
        if (min !== null && num < min) {
          markInvalid(fieldEl, `הערך המינימלי הוא ${min}`);
          valid = false;
          return;
        }
        if (max !== null && num > max) {
          markInvalid(fieldEl, `הערך המקסימלי הוא ${max}`);
          valid = false;
          return;
        }
      }
    });

    return valid;
  }

  // Step-specific extra rule: at least one style must be selected.
  function validateStyleSelected(styleGridEl) {
    return !!styleGridEl.querySelector('.style-card.selected');
  }

  return { validateStep, validateStyleSelected, markInvalid, clearInvalid };
})();
