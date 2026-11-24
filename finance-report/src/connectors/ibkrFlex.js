// Interactive Brokers via the official Flex Web Service (read-only token + saved Flex Query).
// Flex Query must include: Open Positions, Cash Report, Account Information (XML format).
import { elements, text } from '../xml.js';
import { isoDate, parseNumber, round2 } from '../util.js';
import { guessAssetClass } from '../assetClasses.js';

const BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLASS_BY_CATEGORY = { STK: 'stocks', ETF: 'stocks', FUND: 'stocks', OPT: 'stocks', FUT: 'stocks', BOND: 'bonds', BILL: 'bonds', CRYPTO: 'crypto', CASH: 'cash' };

export function parseFlexStatement(xml, source) {
  const out = { accounts: [], snapshots: [], transactions: [] };
  const statements = xml.split(/<FlexStatement\b/).slice(1).map((s) => '<FlexStatement' + s);
  for (const st of statements) {
    const head = elements(st, 'FlexStatement')[0] || {};
    const info = elements(st, 'AccountInformation')[0] || {};
    const accountId = head.accountId || info.accountId || 'IBKR';
    const base = info.currency || 'USD';
    const d = String(head.toDate || head.whenGenerated || '').replace(/\D/g, '').slice(0, 8);
    const date = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : isoDate(new Date());
    const key = `${source.id}:${accountId}`;
    out.accounts.push({ key, sourceId: source.id, institution: source.label || 'Interactive Brokers', kind: 'brokerage', currency: base, name: `${source.label || 'IBKR'} ${accountId}`, assetClass: 'stocks' });

    const holdings = [];
    for (const p of elements(st, 'OpenPosition')) {
      if (p.levelOfDetail && p.levelOfDetail !== 'SUMMARY') continue;
      const qty = parseNumber(p.position);
      const value = parseNumber(p.positionValue) ?? (qty ?? 0) * (parseNumber(p.markPrice) ?? 0);
      holdings.push({
        symbol: p.symbol, name: p.description || p.symbol, quantity: qty, price: parseNumber(p.markPrice),
        value: round2(value), currency: p.currency || base,
        assetClass: CLASS_BY_CATEGORY[p.assetCategory] || guessAssetClass(p.description, 'stocks'),
      });
    }
    const cashRows = elements(st, 'CashReportCurrency');
    const perCcy = cashRows.filter((c) => c.currency && c.currency !== 'BASE_SUMMARY');
    for (const c of (perCcy.length ? perCcy : cashRows)) {
      const v = parseNumber(c.endingCash);
      if (!v) continue;
      const ccy = c.currency === 'BASE_SUMMARY' ? base : c.currency;
      holdings.push({ symbol: ccy, name: `מזומן ${ccy}`, quantity: v, price: 1, value: round2(v), currency: ccy, assetClass: 'cash' });
    }
    out.snapshots.push({ date, accountKey: key, currency: 'MIXED', balance: null, holdings });
  }
  if (!statements.length) throw new Error('No <FlexStatement> found — check that the Flex Query output format is XML.');
  return out;
}

export async function fetchIbkrFlex(source, { token }, { fetchImpl = globalThis.fetch, log = console.log, pollMs = 5000, maxPolls = 24 } = {}) {
  if (!token || !source.queryId) throw new Error('IBKR needs a Flex token (creds set) and "queryId" in config.');
  const send = await (await fetchImpl(`${BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(source.queryId)}&v=3`)).text();
  if (text(send, 'Status') !== 'Success') throw new Error(`Flex SendRequest failed: ${text(send, 'ErrorMessage') || send.slice(0, 200)}`);
  const ref = text(send, 'ReferenceCode');
  const url = text(send, 'Url') || `${BASE}/GetStatement`;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(i === 0 ? 2000 : pollMs);
    const body = await (await fetchImpl(`${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(ref)}&v=3`)).text();
    if (body.includes('<FlexQueryResponse')) return parseFlexStatement(body, source);
    const code = text(body, 'ErrorCode');
    if (code !== '1019' && code !== '1018') throw new Error(`Flex GetStatement failed: ${text(body, 'ErrorMessage') || body.slice(0, 200)}`);
    log(`    ${source.id}: statement still generating…`);
  }
  throw new Error('Timed out waiting for the IBKR Flex statement.');
}
