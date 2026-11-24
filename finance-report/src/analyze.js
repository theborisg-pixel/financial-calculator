// Turn the raw store into the numbers the report and exports need. Pure function of (store, config, today).
import { makeConverter } from './fx.js';
import { buildRules, categorize, TRANSFER_CATEGORIES } from './categorize.js';
import { addMonths, isoDate, monthEnd, monthKey, round2 } from './util.js';
import { ASSET_CLASSES } from './assetClasses.js';

const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);

export function analyze(store, cfg = {}, { today = new Date() } = {}) {
  const data = store.data || store;
  const toILS = makeConverter(data.fx);
  const todayIso = isoDate(today);
  const thisMonth = monthKey(todayIso);
  const accounts = Object.values(data.accounts);
  const hasCards = accounts.some((a) => a.kind === 'card');

  const snapValue = (s) => (s.holdings ? sum(s.holdings, (h) => toILS(h.value, h.currency)) : toILS(s.balance ?? 0, s.currency));
  const snapsBy = new Map();
  for (const s of [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!snapsBy.has(s.accountKey)) snapsBy.set(s.accountKey, []);
    snapsBy.get(s.accountKey).push(s);
  }

  // ---- transactions & categories
  const rules = buildRules(cfg);
  const txns = data.transactions.map((t) => {
    let category = t.categoryLocked ? t.category : categorize(t, rules);
    if (category === 'תשלום כרטיס אשראי' && !hasCards) category = 'כרטיס אשראי (לא מפורט)';
    return { ...t, category, amountILS: toILS(t.amount, t.currency), transfer: TRANSFER_CATEGORIES.has(category) };
  });
  const txByAccount = new Map();
  for (const t of txns) { if (!txByAccount.has(t.accountKey)) txByAccount.set(t.accountKey, []); txByAccount.get(t.accountKey).push(t); }

  // ---- value of each account at a date (real snapshot, else reconstructed bank balance)
  function valueAt(acc, dateIso) {
    const snaps = snapsBy.get(acc.key) || [];
    const prior = snaps.filter((s) => s.date <= dateIso).pop();
    if (prior) return { value: snapValue(prior), estimated: false };
    if (acc.kind === 'manual' && snaps.length) return { value: snapValue(snaps[0]), estimated: false }; // user-declared value, assumed constant
    if (acc.kind === 'card') {
      // Liability at a past date = purchases made by then that were charged after it.
      const tx = txByAccount.get(acc.key) || [];
      if (!tx.length || (tx[0].purchaseDate || tx[0].date) > dateIso) return null;
      return { value: toILS(sum(tx.filter((t) => (t.purchaseDate || t.date) <= dateIso && t.date > dateIso), (t) => t.amount), acc.currency), estimated: true };
    }
    if (acc.kind === 'bank' && snaps.length && snaps[0].balance != null) {
      // Walk back from the first real balance using transactions between dateIso and that snapshot.
      const first = snaps[0];
      const after = (txByAccount.get(acc.key) || []).filter((t) => t.status !== 'pending' && t.date > dateIso && t.date <= first.date);
      const firstTx = (txByAccount.get(acc.key) || [])[0];
      if (!firstTx || firstTx.date > dateIso) return null; // no transaction history that far back
      return { value: toILS(first.balance - sum(after, (t) => t.amount), first.currency), estimated: true };
    }
    return null;
  }

  // ---- current positions
  const rows = [];
  const holdings = [];
  for (const acc of accounts) {
    const snaps = snapsBy.get(acc.key) || [];
    const last = snaps[snaps.length - 1];
    if (!last) continue;
    const value = snapValue(last);
    rows.push({ ...acc, value: round2(value), asOf: last.date, stale: daysBetween(last.date, todayIso) > (cfg.staleDays ?? 14), note: last.note });
    for (const h of last.holdings || []) holdings.push({ ...h, account: acc.name, institution: acc.institution, valueILS: round2(toILS(h.value, h.currency)) });
  }
  const assetsTotal = sum(rows.filter((r) => r.value > 0), (r) => r.value);
  const liabilitiesTotal = sum(rows.filter((r) => r.value < 0), (r) => r.value);
  const netWorth = assetsTotal + liabilitiesTotal;

  // allocation by asset class: holdings use their own class, other accounts their account class
  const byClass = {};
  for (const r of rows) {
    if (r.value < 0) continue;
    const last = (snapsBy.get(r.key) || []).at(-1);
    if (last?.holdings?.length) for (const h of last.holdings) byClass[h.assetClass || r.assetClass] = (byClass[h.assetClass || r.assetClass] || 0) + toILS(h.value, h.currency);
    else byClass[r.assetClass || 'other'] = (byClass[r.assetClass || 'other'] || 0) + r.value;
  }
  const allocation = Object.entries(byClass).filter(([, v]) => Math.abs(v) >= 1)
    .map(([k, v]) => ({ key: k, label: ASSET_CLASSES[k]?.label || k, value: round2(v), pct: assetsTotal ? v / assetsTotal : 0 }))
    .sort((a, b) => b.value - a.value);
  const byInstitution = Object.entries(rows.reduce((m, r) => ((m[r.institution] = (m[r.institution] || 0) + r.value), m), {}))
    .map(([k, v]) => ({ label: k, value: round2(v) })).sort((a, b) => b.value - a.value);

  // ---- months covered
  const allDates = [...data.snapshots.map((s) => s.date), ...txns.map((t) => t.date)].filter((d) => d <= todayIso).sort();
  const firstMonth = allDates.length ? monthKey(allDates[0]) : thisMonth;
  const maxMonths = cfg.reportMonths ?? 24;
  const months = [];
  for (let m = firstMonth; m <= thisMonth; m = addMonths(m, 1)) months.push(m);
  const shownMonths = months.slice(-maxMonths);

  // ---- net-worth trend (month ends; current month = today)
  // An account with no history yet at a month is carried back at its first known value (flagged as estimated).
  // The line starts at the first month where accounts with real/derived history cover ≥90% of today's gross value,
  // so adding a new account later doesn't erase the trend, and early months aren't dominated by guesses.
  const liveAccounts = accounts.filter((acc) => (snapsBy.get(acc.key) || []).length);
  const grossNow = sum(rows, (r) => Math.abs(r.value)) || 1;
  const rawTrend = shownMonths.map((m) => {
    const at = m === thisMonth ? todayIso : monthEnd(m);
    let total = 0; let estValue = 0; let covered = 0;
    for (const acc of liveAccounts) {
      let v = valueAt(acc, at);
      let carried = false;
      if (!v) { v = { value: snapValue(snapsBy.get(acc.key)[0]), estimated: true }; carried = true; }
      total += v.value;
      if (v.estimated) estValue += Math.abs(v.value);
      if (!carried) covered += Math.abs(rows.find((r) => r.key === acc.key)?.value ?? 0);
    }
    return { month: m, value: round2(total), coverage: covered / grossNow, estimatedShare: estValue / grossNow };
  });
  const start = rawTrend.findIndex((p) => p.coverage >= 0.9);
  const trend = (start < 0 ? rawTrend.slice(-1) : rawTrend.slice(start))
    .map(({ coverage, ...p }) => ({ ...p, estimatedShare: round2(p.estimatedShare), estimated: p.estimatedShare > 0.05 }));

  // ---- cash flow
  const flowTx = txns.filter((t) => !t.transfer);
  const cashflow = shownMonths.map((m) => {
    const mt = flowTx.filter((t) => t.month === m);
    const income = sum(mt.filter((t) => t.amountILS > 0), (t) => t.amountILS);
    const expenses = -sum(mt.filter((t) => t.amountILS < 0), (t) => t.amountILS);
    return { month: m, income: round2(income), expenses: round2(expenses), net: round2(income - expenses), partial: m === thisMonth, count: mt.length };
  }).filter((c) => c.count > 0);
  const full = cashflow.filter((c) => !c.partial).slice(-3);
  const avgIncome = full.length ? sum(full, (c) => c.income) / full.length : 0;
  const avgExpenses = full.length ? sum(full, (c) => c.expenses) / full.length : 0;
  const savingsRate = avgIncome > 0 ? (avgIncome - avgExpenses) / avgIncome : null;

  // ---- spending by category: last full month vs 3-month average
  const lastFull = full.at(-1)?.month;
  const fullMonths = new Set(full.map((c) => c.month));
  const catMap = {};
  for (const t of flowTx) {
    if (t.amountILS >= 0 || !fullMonths.has(t.month)) continue;
    const c = (catMap[t.category] ||= { category: t.category, last: 0, total: 0 });
    c.total += -t.amountILS;
    if (t.month === lastFull) c.last += -t.amountILS;
  }
  const categories = Object.values(catMap).map((c) => ({ category: c.category, last: round2(c.last), avg: round2(c.total / (full.length || 1)) }))
    .sort((a, b) => b.avg - a.avg);
  const incomeSources = Object.values(flowTx.filter((t) => t.amountILS > 0 && fullMonths.has(t.month)).reduce((m, t) => {
    (m[t.category] ||= { category: t.category, total: 0 }).total += t.amountILS; return m;
  }, {})).map((c) => ({ category: c.category, avg: round2(c.total / (full.length || 1)) })).sort((a, b) => b.avg - a.avg);

  const topExpenses = flowTx.filter((t) => t.month === lastFull && t.amountILS < 0).sort((a, b) => a.amountILS - b.amountILS).slice(0, 12);

  const warnings = [];
  if (toILS.missing.size) warnings.push(`חסרים שערי המרה עבור: ${[...toILS.missing].join(', ')} — הסכומים הוצגו ללא המרה. הוסף "fxRates" לקובץ ההגדרות.`);
  for (const r of rows.filter((x) => x.stale)) warnings.push(`הנתונים של "${r.name}" ישנים (מעודכנים ל-${r.asOf}).`);
  const uncategorized = flowTx.filter((t) => t.category === 'אחר' && fullMonths.has(t.month)).length;
  if (uncategorized) warnings.push(`${uncategorized} תנועות ב-3 החודשים האחרונים סווגו "אחר" — אפשר להוסיף מילות מפתח תחת "categories" בהגדרות.`);
  if (trend.some((p) => p.estimated)) warnings.push('חלק מנקודות מגמת השווי הנקי מוערכות לאחור מתנועות העו"ש (מסומנות בקו מקווקו).');
  if (trend.length < 2) warnings.push('מגמת השווי הנקי תתמלא עם הזמן — הרץ את האיסוף לפחות פעם בחודש.');

  holdings.sort((a, b) => b.valueILS - a.valueILS);
  return {
    generatedAt: new Date().toISOString(), today: todayIso, fx: data.fx,
    netWorth: round2(netWorth), assetsTotal: round2(assetsTotal), liabilitiesTotal: round2(liabilitiesTotal),
    accounts: rows.sort((a, b) => b.value - a.value), holdings, allocation, byInstitution, trend, cashflow,
    avgIncome: round2(avgIncome), avgExpenses: round2(avgExpenses), savingsRate, fullMonthsCount: full.length,
    categories, incomeSources, lastFullMonth: lastFull, topExpenses, warnings,
    transactions: txns.map((t) => ({ ...t, account: data.accounts[t.accountKey]?.name || t.accountKey })).reverse(),
  };
}

function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
