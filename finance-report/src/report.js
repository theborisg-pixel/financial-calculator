// Render the analysis into one self-contained, offline HTML file (Hebrew, RTL, light/dark). No external requests.
import { fmtILS } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n, o) => `<span class="num" dir="ltr">${esc(fmtILS(n, o))}</span>`;
const pct = (x, d = 0) => (x == null ? '—' : `<span class="num" dir="ltr">${(x * 100).toFixed(d)}%</span>`);
const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const monthLabel = (m) => `${HE_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const compact = (n) => { const a = Math.abs(n); const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a) + ''; return (n < 0 ? '-' : '') + s; };

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min; const step0 = span / count; const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= count) || step0;
  const lo = Math.floor(min / step) * step; const hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// ---------- charts (inline SVG, LTR time axis, Hebrew labels)
function lineChart(points) {
  if (points.length < 2) return '<p class="muted">מגמה תוצג אחרי שיהיו נתונים מיותר מחודש אחד. הרץ את האיסוף מדי חודש.</p>';
  const W = 720, H = 240, L = 56, R = 16, T = 16, B = 28;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...vals) < 0 ? Math.min(...vals) : Math.min(...vals) * 0.9, Math.max(...vals));
  const y0 = ticks[0], y1 = ticks.at(-1);
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + ((y1 - v) * (H - T - B)) / (y1 - y0 || 1);
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('');
  const every = Math.ceil(points.length / 8);
  const xl = points.map((p, i) => (i % every === 0 || i === points.length - 1) ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${monthLabel(p.month)}</text>` : '').join('');
  const firstReal = points.findIndex((p) => !p.estimated);
  const seg = (a, b) => points.slice(a, b + 1).map((p, j) => `${j ? 'L' : 'M'}${x(a + j).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  let path = '';
  if (firstReal > 0) path += `<path class="line est" d="${seg(0, firstReal)}"/>`;
  path += `<path class="line" d="${seg(Math.max(0, firstReal), points.length - 1)}"/>`;
  const area = `<path class="area" d="${seg(0, points.length - 1)}L${x(points.length - 1)},${y(y0)}L${x(0)},${y(y0)}Z"/>`;
  const dots = points.map((p, i) => `<circle class="dot${i === points.length - 1 ? ' last' : ''}" cx="${x(i)}" cy="${y(p.value)}" r="${i === points.length - 1 ? 4 : 0}"/>
    <rect class="hit" x="${x(i) - (W - L - R) / (points.length - 1) / 2}" y="${T}" width="${(W - L - R) / (points.length - 1)}" height="${H - T - B}" data-tip="${esc(monthLabel(p.month))}: ${esc(fmtILS(p.value))}${p.estimated ? ' (הערכה)' : ''}" data-x="${x(i)}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="מגמת שווי נקי">${grid}${area}${path}<line class="xhair" y1="${T}" y2="${H - B}"/>${dots}${xl}</svg>`;
}

function barChart(cf) {
  if (!cf.length) return '<p class="muted">אין עדיין תנועות. חבר בנק או כרטיס אשראי.</p>';
  const W = 720, H = 240, L = 56, R = 16, T = 16, B = 28;
  const max = Math.max(...cf.flatMap((c) => [c.income, c.expenses]), 1);
  const ticks = niceTicks(0, max);
  const top = ticks.at(-1);
  const y = (v) => T + ((top - v) * (H - T - B)) / top;
  const band = (W - L - R) / cf.length; const bw = Math.min(18, (band - 10) / 2);
  const grid = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('');
  const bar = (cx, v, cls) => { const h = Math.max(0, y(0) - y(v)); const r = Math.min(4, h / 2, bw / 2);
    return `<path class="${cls}" d="M${cx},${y(0)}V${y(v) + r}Q${cx},${y(v)} ${cx + r},${y(v)}H${cx + bw - r}Q${cx + bw},${y(v)} ${cx + bw},${y(v) + r}V${y(0)}Z"/>`; };
  const bars = cf.map((c, i) => {
    const cx = L + i * band + band / 2;
    return `<g class="${c.partial ? 'partial' : ''}">${bar(cx - bw - 1, c.income, 's1')}${bar(cx + 1, c.expenses, 's2')}
      <rect class="hit" x="${L + i * band}" y="${T}" width="${band}" height="${H - T - B}" data-tip="${esc(monthLabel(c.month))}${c.partial ? ' (חלקי)' : ''} · הכנסות ${esc(fmtILS(c.income))} · הוצאות ${esc(fmtILS(c.expenses))} · נטו ${esc(fmtILS(c.net))}"/>
      <text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(c.month)}</text></g>`;
  }).join('');
  return `<div class="legend"><span><i class="sw s1"></i>הכנסות</span><span><i class="sw s2"></i>הוצאות</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="תזרים חודשי">${grid}<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${bars}</svg>`;
}

function allocationBar(items) {
  const MAX = 7; // fixed-order categorical slots; the rest fold into "other"
  let list = items;
  if (items.length > MAX + 1) {
    const rest = items.slice(MAX);
    list = [...items.slice(0, MAX), { key: '_rest', label: 'שאר', value: rest.reduce((s, x) => s + x.value, 0), pct: rest.reduce((s, x) => s + x.pct, 0) }];
  }
  const segs = list.map((a, i) => `<span class="seg c${i + 1}" style="flex:${Math.max(a.pct, 0.004)}" data-tip="${esc(a.label)}: ${esc(fmtILS(a.value))} (${(a.pct * 100).toFixed(1)}%)"></span>`).join('');
  const legend = list.map((a, i) => `<li><i class="sw c${i + 1}"></i><span class="lbl">${esc(a.label)}</span>${pct(a.pct, 1)}${money(a.value)}</li>`).join('');
  return `<div class="stack">${segs}</div><ul class="alloc">${legend}</ul>`;
}

function hbarTable(rows, { valueKey, label, extra = [], tone = 's2' }) {
  const max = Math.max(...rows.map((r) => Math.abs(r[valueKey])), 1);
  return `<table><thead><tr><th>${label}</th>${extra.map((e) => `<th class="n">${e.title}</th>`).join('')}<th class="n">${esc(rows.valueTitle || '')}</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td><div class="cell-bar"><span>${esc(r.label ?? r.category)}</span><i class="${tone}" style="width:${(Math.abs(r[valueKey]) / max) * 100}%"></i></div></td>${extra.map((e) => `<td class="n">${e.fmt(r)}</td>`).join('')}<td class="n">${money(r[valueKey])}</td></tr>`).join('')}
  </tbody></table>`;
}

export function renderReport(a, { title = 'דוח פיננסי אישי' } = {}) {
  const lastTrend = a.trend.at(-2);
  const delta = lastTrend ? a.netWorth - lastTrend.value : null;
  const kpis = [
    ['שווי נקי', money(a.netWorth), delta == null ? '' : `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${money(delta)} מהחודש הקודם</span>`],
    ['נכסים', money(a.assetsTotal), `התחייבויות ${money(a.liabilitiesTotal)}`],
    ['הכנסה חודשית ממוצעת', money(a.avgIncome), `${a.fullMonthsCount} חודשים מלאים אחרונים`],
    ['הוצאה חודשית ממוצעת', money(a.avgExpenses), `שיעור חיסכון ${pct(a.savingsRate)}`],
  ];
  const categoriesRows = Object.assign(a.categories.map((c) => ({ ...c, label: c.category })), { valueTitle: 'ממוצע חודשי' });
  const instRows = Object.assign(a.byInstitution.map((x) => x), { valueTitle: 'שווי' });

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light;--bg:#f6f6f4;--surface:#fcfcfb;--border:#e4e3df;--text:#0b0b0b;--text2:#52514e;--muted:#7a7974;--grid:#ebeae6;
--s1:#2a78d6;--s2:#eb6834;--c1:#2a78d6;--c2:#eb6834;--c3:#1baf7a;--c4:#eda100;--c5:#e87ba4;--c6:#008300;--c7:#6250d6;--c8:#e34948;--good:#006300;--bad:#d03b3b;--warnbg:#fff6e0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#111110;--surface:#1a1a19;--border:#2e2e2b;--text:#f0efec;--text2:#c3c2b7;--muted:#8f8e86;--grid:#2a2a27;
--s1:#3987e5;--s2:#d95926;--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--c5:#d55181;--c6:#0ca30c;--c7:#9085e9;--c8:#e66767;--good:#0ca30c;--bad:#e66767;--warnbg:#2b2414}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#111110;--surface:#1a1a19;--border:#2e2e2b;--text:#f0efec;--text2:#c3c2b7;--muted:#8f8e86;--grid:#2a2a27;
--s1:#3987e5;--s2:#d95926;--c1:#3987e5;--c2:#d95926;--c3:#199e70;--c4:#c98500;--c5:#d55181;--c6:#0ca30c;--c7:#9085e9;--c8:#e66767;--good:#0ca30c;--bad:#e66767;--warnbg:#2b2414}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,"Noto Sans Hebrew",sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
header h1{margin:0;font-size:26px}header p{margin:4px 0 0;color:var(--text2)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:760px){.grid2{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;margin-top:16px;min-width:0}
.card h2{margin:0 0 12px;font-size:17px}.muted{color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}@media (max-width:760px){.kpis{grid-template-columns:1fr 1fr}}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.kpi .t{color:var(--text2);font-size:13px}.kpi .v{font-size:24px;font-weight:650;margin:2px 0}.kpi .s{font-size:12.5px;color:var(--text2)}
.up{color:var(--good)}.down{color:var(--bad)}.num{font-variant-numeric:tabular-nums;unicode-bidi:isolate}
.warn{background:var(--warnbg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-top:16px;font-size:13.5px}.warn ul{margin:4px 0;padding-inline-start:20px}
svg.chart{width:100%;height:auto;display:block;direction:ltr}
.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--muted);stroke-width:1}.axis{fill:var(--muted);font-size:11px}
.line{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round}.line.est{stroke-dasharray:4 4;opacity:.8}.area{fill:var(--s1);opacity:.08}
.dot{fill:var(--s1);stroke:var(--surface);stroke-width:2}.xhair{stroke:var(--muted);stroke-width:1;opacity:0}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}.partial path{opacity:.45}.hit{fill:transparent;cursor:default}
.legend{display:flex;gap:16px;font-size:13px;color:var(--text2);margin-bottom:6px}.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:6px;vertical-align:middle}
.sw.s1{background:var(--s1)}.sw.s2{background:var(--s2)}
${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `.c${i}{background:var(--c${i})}`).join('')}
.stack{display:flex;gap:2px;height:22px;border-radius:6px;overflow:hidden}.seg{min-width:3px}
ul.alloc{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:6px}ul.alloc li{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;font-size:14px}ul.alloc .num{color:var(--text2)}
table{width:100%;border-collapse:collapse;font-size:14px}th{font-weight:600;color:var(--text2);text-align:start;font-size:12.5px;border-bottom:1px solid var(--border);padding:6px 8px}
td{border-bottom:1px solid var(--grid);padding:6px 8px;vertical-align:middle}th.n,td.n{text-align:end;white-space:nowrap}
.cell-bar{position:relative;padding:2px 0}.cell-bar span{position:relative;z-index:1}.cell-bar i{position:absolute;inset-inline-start:0;bottom:0;height:3px;border-radius:2px;opacity:.7}.cell-bar i.s1{background:var(--s1)}.cell-bar i.s2{background:var(--s2)}
.scroll{overflow-x:auto}.tag{font-size:11.5px;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:0 6px;margin-inline-start:6px;white-space:nowrap}
#tip{position:fixed;pointer-events:none;background:var(--text);color:var(--surface);padding:6px 10px;border-radius:8px;font-size:12.5px;opacity:0;transition:opacity .1s;z-index:9;max-width:320px}
footer{margin-top:24px;color:var(--muted);font-size:12.5px}
details summary{cursor:pointer;color:var(--text2);font-size:13px;margin-top:8px}
</style></head><body><main>
<header><h1>${esc(title)}</h1><p>נכון ל-${esc(a.today)} · שערי מט"ח: ${esc(a.fx?.source || '—')} ${a.fx?.rates?.USD ? `(USD ${a.fx.rates.USD.toFixed(3)})` : ''}</p></header>
<section class="kpis">${kpis.map(([t, v, s]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('')}</section>
${a.warnings.length ? `<div class="warn"><strong>לתשומת לב</strong><ul>${a.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

<section class="card"><h2>מגמת שווי נקי</h2>${lineChart(a.trend)}
<details><summary>טבלת נתונים</summary><table><thead><tr><th>חודש</th><th class="n">שווי נקי</th></tr></thead><tbody>${a.trend.map((p) => `<tr><td>${monthLabel(p.month)}${p.estimated ? '<span class="tag">הערכה</span>' : ''}</td><td class="n">${money(p.value)}</td></tr>`).join('')}</tbody></table></details></section>

<div class="grid2">
<section class="card"><h2>הקצאת נכסים</h2>${a.allocation.length ? allocationBar(a.allocation) : '<p class="muted">אין נכסים עדיין.</p>'}</section>
<section class="card"><h2>לפי מוסד</h2>${hbarTable(instRows, { valueKey: 'value', label: 'מוסד', tone: 's1' })}</section>
</div>

<section class="card"><h2>תזרים חודשי</h2>${barChart(a.cashflow)}
<details><summary>טבלת נתונים</summary><table><thead><tr><th>חודש</th><th class="n">הכנסות</th><th class="n">הוצאות</th><th class="n">נטו</th></tr></thead><tbody>${a.cashflow.map((c) => `<tr><td>${monthLabel(c.month)}${c.partial ? '<span class="tag">חלקי</span>' : ''}</td><td class="n">${money(c.income)}</td><td class="n">${money(c.expenses)}</td><td class="n ${c.net >= 0 ? 'up' : 'down'}">${money(c.net)}</td></tr>`).join('')}</tbody></table></details>
<p class="muted" style="font-size:12.5px">העברות בין חשבונות שלך, הפקדות להשקעות ותשלומי כרטיס אשראי (כשהכרטיס מחובר) לא נספרים כהוצאה.</p></section>

<div class="grid2">
<section class="card"><h2>הוצאות לפי קטגוריה</h2>${a.categories.length ? hbarTable(categoriesRows, { valueKey: 'avg', label: 'קטגוריה', extra: [{ title: a.lastFullMonth ? monthLabel(a.lastFullMonth) : 'חודש אחרון', fmt: (r) => money(r.last) }] }) : '<p class="muted">אין נתונים.</p>'}</section>
<section class="card"><h2>הוצאות גדולות${a.lastFullMonth ? ` · ${monthLabel(a.lastFullMonth)}` : ''}</h2>${a.topExpenses.length ? `<table><thead><tr><th>תאריך</th><th>תיאור</th><th class="n">סכום</th></tr></thead><tbody>${a.topExpenses.map((t) => `<tr><td class="num">${esc(t.date.slice(5).split('-').reverse().join('/'))}</td><td>${esc(t.description)}<span class="tag">${esc(t.category)}</span></td><td class="n">${money(t.amountILS)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">אין נתונים.</p>'}
${a.incomeSources.length ? `<h2 style="margin-top:18px">מקורות הכנסה (ממוצע חודשי)</h2><table><tbody>${a.incomeSources.map((c) => `<tr><td>${esc(c.category)}</td><td class="n">${money(c.avg)}</td></tr>`).join('')}</tbody></table>` : ''}</section>
</div>

<section class="card"><h2>חשבונות</h2><div class="scroll"><table><thead><tr><th>חשבון</th><th>מוסד</th><th>סוג</th><th>עדכון</th><th class="n">שווי (₪)</th></tr></thead><tbody>
${a.accounts.map((r) => `<tr><td>${esc(r.name)}${r.note ? `<span class="tag">${esc(r.note)}</span>` : ''}</td><td>${esc(r.institution)}</td><td>${esc(labelKind(r))}</td><td class="num">${esc(r.asOf)}${r.stale ? ' <span class="tag">ישן</span>' : ''}</td><td class="n ${r.value < 0 ? 'down' : ''}">${money(r.value)}</td></tr>`).join('')}
</tbody></table></div></section>

${a.holdings.length ? `<section class="card"><h2>אחזקות</h2><div class="scroll"><table><thead><tr><th>נייר</th><th>חשבון</th><th class="n">כמות</th><th class="n">מטבע</th><th class="n">שווי (₪)</th><th class="n">% מהנכסים</th></tr></thead><tbody>
${a.holdings.map((h) => `<tr><td>${esc(h.name)}${h.symbol && h.symbol !== h.name ? `<span class="tag" dir="ltr">${esc(h.symbol)}</span>` : ''}</td><td>${esc(h.account)}</td><td class="n num">${h.quantity == null ? '—' : esc(Number(h.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 }))}</td><td class="n">${esc(h.currency)}</td><td class="n">${money(h.valueILS)}</td><td class="n">${pct(a.assetsTotal ? h.valueILS / a.assetsTotal : 0, 1)}</td></tr>`).join('')}
</tbody></table></div></section>` : ''}

<footer>נוצר מקומית ב-${esc(new Date(a.generatedAt).toLocaleString('he-IL'))}. הקובץ מכיל מידע פיננסי אישי — אל תשתף אותו. אין לראות בדוח ייעוץ השקעות.</footer>
</main><div id="tip" role="tooltip"></div>
<script>
const tip=document.getElementById('tip');
document.addEventListener('pointermove',e=>{const t=e.target.closest('[data-tip]');
 document.querySelectorAll('.xhair').forEach(l=>l.style.opacity=0);
 if(!t){tip.style.opacity=0;return}
 tip.textContent=t.dataset.tip;tip.style.opacity=1;
 const w=tip.offsetWidth;tip.style.left=Math.min(innerWidth-w-8,Math.max(8,e.clientX-w/2))+'px';tip.style.top=(e.clientY-44)+'px';
 if(t.dataset.x){const l=t.ownerSVGElement.querySelector('.xhair');l.setAttribute('x1',t.dataset.x);l.setAttribute('x2',t.dataset.x);l.style.opacity=.6}});
</script></body></html>`;
}

function labelKind(r) {
  return { bank: 'עו"ש', card: 'כרטיס אשראי', brokerage: 'תיק השקעות', pension: 'חיסכון פנסיוני', manual: r.liability ? 'התחייבות' : 'נכס ידני' }[r.kind] || r.kind;
}
