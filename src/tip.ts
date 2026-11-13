// Info tooltips: a small "?" button that shows a short explanation on hover, focus or tap.
// Markup: <button type="button" class="tip" data-tip="Text to show">?</button>
// tipHTML(text) builds that markup for content rendered from JS.

const bubble = document.createElement('div');
bubble.className = 'tip-bubble';
bubble.id = 'tip-bubble';
bubble.setAttribute('role', 'tooltip');
bubble.hidden = true;
let current: HTMLElement | null = null;   // the button the bubble is showing for
let pinned = false;   // opened by a click/tap, so it stays until dismissed

function show(btn: HTMLElement) {
  if (!bubble.isConnected) document.body.appendChild(bubble);
  current = btn;
  bubble.textContent = btn.dataset.tip ?? '';
  bubble.hidden = false;
  btn.setAttribute('aria-describedby', bubble.id);
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const pad = 8;
  const left = Math.min(Math.max(pad, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - pad);
  const below = r.bottom + 6;
  const top = below + b.height + pad > window.innerHeight ? r.top - b.height - 6 : below;
  bubble.style.left = `${left}px`;
  bubble.style.top = `${Math.max(pad, top)}px`;
}

function hide() {
  if (current) {
    current.removeAttribute('aria-describedby');
    current.setAttribute('aria-expanded', 'false');
  }
  current = null;
  pinned = false;
  bubble.hidden = true;
}

const tipOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('.tip') : null);

document.addEventListener('click', e => {
  const btn = tipOf(e);
  if (btn) {
    e.preventDefault();   // a tip inside a <label> must not open its file picker
    e.stopPropagation();
    if (current === btn && pinned) hide(); else { show(btn); pinned = true; }
  } else if (!(e.target instanceof Node && bubble.contains(e.target))) hide();
}, true);
document.addEventListener('mouseover', e => { const btn = tipOf(e); if (btn && !pinned) show(btn); });
document.addEventListener('mouseout', e => { if (tipOf(e) && !pinned) hide(); });
document.addEventListener('focusin', e => { const btn = tipOf(e); if (btn) show(btn); });
document.addEventListener('focusout', e => { if (tipOf(e)) hide(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) hide(); });
window.addEventListener('scroll', () => { if (current) hide(); }, true);
window.addEventListener('resize', () => { if (current) hide(); });

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

export function tipHTML(text: string): string {
  return `<button type="button" class="tip" aria-label="More info" aria-expanded="false" data-tip="${esc(text)}">?</button>`;
}
