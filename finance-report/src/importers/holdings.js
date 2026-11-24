// Import a portfolio/holdings export (Israeli brokers: IBI, Meitav, Excellence, bank trading accounts, or any broker CSV/XLSX).
import { readTable, findHeader } from './table.js';
import { parseNumber, isoDate, round2 } from '../util.js';
import { guessAssetClass } from '../assetClasses.js';

export const HOLDING_ALIASES = {
  name: ['שם נייר', 'שם הנייר', 'שם ני"ע', 'שם נייר ערך', 'שם המניה', 'נייר', 'תיאור', 'שם', 'name', 'description', 'security', 'instrument'],
  symbol: ['מספר נייר', "מס' נייר", 'מס נייר', 'מספר ני"ע', 'מס ני"ע', 'סימול', 'symbol', 'ticker', 'isin', 'security id'],
  quantity: ['כמות', 'כמות נוכחית', 'יחידות', 'quantity', 'qty', 'position', 'shares'],
  price: ['שער', 'שער אחרון', 'שער נוכחי', 'מחיר', 'last', 'price', 'last price', 'mark price', 'current price'],
  value: ['שווי', 'שווי נוכחי', 'שווי בש"ח', 'שווי שוק', 'שווי אחזקה', 'שווי בשקלים', 'market value', 'value', 'position value', 'total value'],
  currency: ['מטבע', 'currency', 'ccy'],
};

/** Pure: rows → holdings. `opts.priceInAgorot` divides price by 100 (TASE shares are quoted in agorot). */
export function holdingsFromRows(rows, opts = {}) {
  const hdr = findHeader(rows, HOLDING_ALIASES, { minMatches: 2, required: ['name'] });
  if (!hdr || !('value' in hdr.cols || ('quantity' in hdr.cols && 'price' in hdr.cols))) return null;
  const { cols } = hdr;
  const holdings = [];
  const warnings = [];
  for (const r of rows.slice(hdr.headerIndex + 1)) {
    const name = String(r[cols.name] ?? '').trim();
    if (!name || /^(סה"?כ|סך הכל|total)/i.test(name)) continue;
    const qty = parseNumber(r[cols.quantity]);
    let price = parseNumber(r[cols.price]);
    if (price != null && opts.priceInAgorot) price /= 100;
    let value = parseNumber(r[cols.value]);
    if (value == null && qty != null && price != null) {
      value = qty * price;
      if (!opts.priceInAgorot) warnings.push(`"${name}": value computed as quantity × price — if the broker quotes in agorot, set "priceInAgorot": true for this source.`);
    }
    if (value == null) continue;
    const currency = String(r[cols.currency] ?? '').trim() || opts.currency || 'ILS';
    holdings.push({
      symbol: String(r[cols.symbol] ?? '').trim() || null, name, quantity: qty, price, value: round2(value),
      currency: /ש"?ח|שקל|nis|ils|₪/i.test(currency) ? 'ILS' : /דולר|\$|usd/i.test(currency) ? 'USD' : currency.toUpperCase(),
      assetClass: guessAssetClass(name, opts.assetClass || 'stocks'),
    });
  }
  return { holdings, warnings };
}

export async function importHoldingsFile(source, file, { date = isoDate(new Date()) } = {}) {
  const sheets = await readTable(file);
  for (const sheet of sheets) {
    const res = holdingsFromRows(sheet.rows, source);
    if (res && res.holdings.length) {
      const key = `${source.id}:${source.account || 'portfolio'}`;
      return {
        accounts: [{ key, sourceId: source.id, institution: source.label || source.id, kind: 'brokerage', currency: 'MIXED', name: source.label || source.id, assetClass: source.assetClass || 'stocks' }],
        snapshots: [{ date, accountKey: key, balance: null, currency: 'MIXED', holdings: res.holdings }],
        transactions: [],
        warnings: res.warnings,
      };
    }
  }
  throw new Error(`Could not find a holdings table in ${file}. Expected columns like: שם נייר / כמות / שער / שווי (or Name / Quantity / Price / Value).`);
}
