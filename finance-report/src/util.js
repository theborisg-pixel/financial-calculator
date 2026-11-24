import crypto from 'node:crypto';

/** Parse numbers as they appear in Israeli/English exports: "1,234.50", "₪ 1,234", "(12.5)", "-12%", "12-". */
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'result' in v) return parseNumber(v.result); // exceljs formula cell
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  s = s.replace(/[₪$€£%\s‎‏‪-‮]/g, '').replace(/,/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export const monthKey = (d) => (typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : isoDate(d).slice(0, 7));

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return isoDate(new Date(y, m, 0));
}

export const hashId = (...parts) =>
  crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 16);

export const normalizeHeader = (h) =>
  String(h ?? '').replace(/[‎‏‪-‮]/g, '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function fmtILS(n, { digits = 0 } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (n < 0 ? '-' : '') + '₪' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
