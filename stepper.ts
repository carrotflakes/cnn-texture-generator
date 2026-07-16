// Numeric seed field with −/+ steppers, shared by the catalog and editor views.

// Returns the HTML for a stepped numeric input used inside a form.
export function seedField(id: string, label: string, value: number): string {
  return `
    <label class="seed-field">
      ${label}
      <div class="stepper">
        <button type="button" class="step-btn" data-target="${id}" data-step="-1" aria-label="Decrease ${label}">−</button>
        <input id="${id}" type="number" step="1" value="${value}">
        <button type="button" class="step-btn" data-target="${id}" data-step="1" aria-label="Increase ${label}">＋</button>
      </div>
    </label>`;
}

// Wires the stepper buttons. Each click adjusts the target input and dispatches an
// input event so the existing regeneration and URL synchronization handlers run.
export function wireSteppers(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>(".step-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const target = root.querySelector<HTMLInputElement>(`#${button.dataset.target}`);
      if (!target) return;
      target.value = String(Math.trunc(Number(target.value)) + Number(button.dataset.step));
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}
