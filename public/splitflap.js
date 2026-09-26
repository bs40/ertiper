// Split-flap display. Each cell steps through the character drum until it reaches its target,
// animating the top leaf falling over the bottom one, like a Solari board.
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./'";
const STEP_MS = 55;
// The flip is the point of the board, so it ignores the OS "reduce motion" setting; add ?still to the URL to turn it off.
const reducedMotion = new URLSearchParams(location.search).has('still');

class FlapCell {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'flap';
    this.el.style.setProperty('--t', `${STEP_MS}ms`);
    this.el.innerHTML =
      '<div class="half top"><span></span></div>' +
      '<div class="half bottom"><span></span></div>' +
      '<div class="half top leaf-top"><span></span></div>' +
      '<div class="half bottom leaf-bottom"><span></span></div>';
    const spans = this.el.querySelectorAll('span');
    [this.top, this.bottom, this.leafTop, this.leafBottom] = spans;
    parent.appendChild(this.el);
    this.current = ' ';
    this.target = ' ';
    this.running = false;
  }

  setChar(ch, delay = 0) {
    this.target = DRUM.includes(ch) ? ch : ' ';
    if (reducedMotion) {
      this.current = this.target;
      for (const s of [this.top, this.bottom, this.leafTop, this.leafBottom]) s.textContent = this.target;
      return;
    }
    if (!this.running && this.current !== this.target) {
      this.running = true;
      setTimeout(() => this.step(), delay);
    }
  }

  step() {
    if (this.current === this.target) {
      this.running = false;
      return;
    }
    const from = this.current;
    const to = DRUM[(DRUM.indexOf(from) + 1) % DRUM.length];
    this.top.textContent = to;
    this.bottom.textContent = from;
    this.leafTop.textContent = from;
    this.leafBottom.textContent = to;
    this.el.classList.remove('go');
    void this.el.offsetWidth; // restart the CSS animation
    this.el.classList.add('go');
    setTimeout(() => {
      this.bottom.textContent = to;
      this.current = to;
      this.step();
    }, STEP_MS);
  }
}

export class FlapRow {
  constructor(container, length, { align = 'left' } = {}) {
    this.length = length;
    this.align = align;
    this.text = null;
    this.cells = Array.from({ length }, () => new FlapCell(container));
  }

  setText(text) {
    let t = String(text ?? '').toUpperCase().slice(0, this.length);
    t = this.align === 'right' ? t.padStart(this.length) : t.padEnd(this.length);
    if (t === this.text) return;
    this.text = t;
    this.cells.forEach((cell, i) => cell.setChar(t[i], i * 45 + Math.random() * 90));
  }
}
