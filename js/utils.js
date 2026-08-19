export const clone = o => JSON.parse(JSON.stringify(o));
export const same  = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const uid   = () => Math.random().toString(36).slice(2, 8);
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const num   = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
export const fmt = n => (Math.round(num(n, 0) * 10) / 10).toString().replace('.', ',');

export const el = h => {
  const t = document.createElement('template');
  t.innerHTML = h.trim();
  return t.content.firstElementChild;
};
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
