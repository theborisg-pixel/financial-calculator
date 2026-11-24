// Exchange rates to ILS. Primary: Bank of Israel public API. Fallbacks: config.fxRates, then last cached rates.
import { isoDate } from './util.js';

const BOI_URL = 'https://boi.org.il/PublicApi/GetExchangeRates';

export function parseBoiRates(json) {
  const list = json?.exchangeRates || json?.currentExchangeRates || [];
  const rates = {};
  for (const r of list) {
    const code = r.key || r.currencyCode;
    const rate = Number(r.currentExchangeRate ?? r.rate);
    const unit = Number(r.unit || 1);
    if (code && rate > 0) rates[code.toUpperCase()] = rate / unit;
  }
  return rates;
}

export async function refreshRates(store, cfg, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  try {
    const res = await fetchImpl(BOI_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rates = parseBoiRates(await res.json());
    if (!Object.keys(rates).length) throw new Error('no rates in response');
    store.data.fx = { date: isoDate(new Date()), source: 'Bank of Israel', rates: { ...(cfg.fxRates || {}), ...rates } };
  } catch (e) {
    const cached = store.data.fx?.rates || {};
    store.data.fx = { date: store.data.fx?.date, source: 'config/cache', rates: { ...cached, ...(cfg.fxRates || {}) } };
    log(`  ! Could not fetch Bank of Israel rates (${e.message}); using ${Object.keys(store.data.fx.rates).length ? 'cached/config rates' : 'NO rates'}.`);
  }
  return store.data.fx;
}

export function makeConverter(fx) {
  const rates = { ILS: 1, NIS: 1, ...(fx?.rates || {}) };
  const missing = new Set();
  const toILS = (amount, currency = 'ILS') => {
    if (amount == null) return 0;
    const c = String(currency || 'ILS').toUpperCase().replace('₪', 'ILS').replace('$', 'USD').replace('€', 'EUR');
    const r = rates[c];
    if (!r) { missing.add(c); return amount; }
    return amount * r;
  };
  toILS.missing = missing;
  return toILS;
}
