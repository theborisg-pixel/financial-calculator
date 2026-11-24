import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseNumber } from '../src/util.js';
import { encrypt, decrypt, Vault } from '../src/vault.js';
import { buildRules, categorize } from '../src/categorize.js';
import { normalizeScrape } from '../src/connectors/israeliBank.js';
import { parseFlexStatement, fetchIbkrFlex } from '../src/connectors/ibkrFlex.js';
import { holdingsFromRows } from '../src/importers/holdings.js';
import { pensionsFromRows, pensionsFromMimshakXml, importPensionFile } from '../src/importers/pension.js';
import { parseCsv, readTable } from '../src/importers/table.js';
import { parseBoiRates, makeConverter } from '../src/fx.js';
import { Store } from '../src/store.js';
import { applyResult, syncManual } from '../src/sources.js';
import { analyze } from '../src/analyze.js';
import { exportCalculatorProfile } from '../src/export.js';
import { buildDemoStore } from '../src/demo.js';
import { renderReport } from '../src/report.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'finreport-'));

test('parseNumber handles Israeli/English formats', () => {
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber('₪ 1,234'), 1234);
  assert.equal(parseNumber('(12.5)'), -12.5);
  assert.equal(parseNumber('12-'), -12);
  assert.equal(parseNumber('0.22%'), 0.22);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber({ result: 7 }), 7);
});

test('vault encrypts, decrypts, and rejects a wrong password', () => {
  const blob = encrypt({ a: { password: 'secret' } }, 'pw');
  assert.ok(!JSON.stringify(blob).includes('secret'));
  assert.deepEqual(decrypt(blob, 'pw'), { a: { password: 'secret' } });
  assert.throws(() => decrypt(blob, 'nope'), /Wrong master password/);
  const v = new Vault(path.join(tmp(), 'v.enc'));
  v.write({ x: { token: 't' } }, 'pw');
  assert.deepEqual(v.read('pw'), { x: { token: 't' } });
  assert.equal(fs.statSync(v.file).mode & 0o777, 0o600);
});

test('categorize: word boundaries, income-only rules, custom rules first', () => {
  const r = buildRules({ categories: { 'חוגים': ['קונסרבטוריון'] } });
  assert.equal(categorize({ description: 'HOTEL ROME', amount: -1 }, r), 'טיסות ונופש');
  assert.equal(categorize({ description: 'HOT מובייל', amount: -1 }, r), 'חשבונות ותקשורת');
  assert.equal(categorize({ description: 'ביטוח לאומי', amount: -100 }, r), 'ביטוחים');
  assert.equal(categorize({ description: 'ביטוח לאומי', amount: 100 }, r), 'קצבאות והחזרים');
  assert.equal(categorize({ description: 'קונסרבטוריון העיר', amount: -1 }, r), 'חוגים');
  assert.equal(categorize({ description: 'xyz', amount: -1 }, r), 'אחר');
  assert.equal(categorize({ description: 'xyz', amount: 1 }, r), 'הכנסות אחרות');
});

test('normalizeScrape: card installments booked by charge date; future charges become a liability', () => {
  const src = { id: 'max', company: 'max', label: 'מקס' };
  const today = new Date('2026-11-15T12:00:00');
  const out = normalizeScrape(src, { success: true, accounts: [{ accountNumber: '1234', txns: [
    { type: 'installments', date: '2026-09-01T00:00:00', processedDate: '2026-12-10T00:00:00', originalAmount: -900, originalCurrency: 'ILS', chargedAmount: -300, description: 'מחסני חשמל', status: 'completed', installments: { number: 3, total: 3 } },
    { type: 'normal', date: '2026-10-05T00:00:00', processedDate: '2026-11-10T00:00:00', originalAmount: -50, originalCurrency: 'ILS', chargedAmount: -50, description: 'ארומה', status: 'completed' },
  ] }] }, { today });
  assert.equal(out.accounts[0].kind, 'card');
  assert.equal(out.transactions[0].month, '2026-12');
  assert.equal(out.transactions[0].purchaseDate, '2026-09-01');
  assert.equal(out.snapshots[0].balance, -300);
  const bank = normalizeScrape({ id: 'b', company: 'hapoalim' }, { success: true, accounts: [{ accountNumber: '9', balance: 1000, txns: [] }] }, { today });
  assert.equal(bank.accounts[0].kind, 'bank');
  assert.equal(bank.snapshots[0].balance, 1000);
});

const FLEX = `<FlexQueryResponse queryName="q" type="AF"><FlexStatements count="1">
<FlexStatement accountId="U1" fromDate="20261101" toDate="20261120" period="MonthToDate">
<AccountInformation accountId="U1" currency="USD"/>
<OpenPositions>
 <OpenPosition symbol="VT" description="VANGUARD TOT WORLD" assetCategory="STK" currency="USD" position="10" markPrice="100" positionValue="1000" levelOfDetail="SUMMARY"/>
 <OpenPosition symbol="VT" description="VANGUARD TOT WORLD" assetCategory="STK" currency="USD" position="10" markPrice="100" positionValue="1000" levelOfDetail="LOT"/>
 <OpenPosition symbol="T 4 1/2" description="US T-BOND &amp; NOTE" assetCategory="BOND" currency="USD" position="1000" markPrice="0.99" positionValue="990"/>
</OpenPositions>
<CashReport><CashReportCurrency currency="BASE_SUMMARY" endingCash="300"/><CashReportCurrency currency="USD" endingCash="200"/><CashReportCurrency currency="EUR" endingCash="90"/></CashReport>
</FlexStatement></FlexStatements></FlexQueryResponse>`;

test('parseFlexStatement: summary positions only, per-currency cash, asset classes', () => {
  const out = parseFlexStatement(FLEX, { id: 'ibkr', label: 'IBKR' });
  const h = out.snapshots[0].holdings;
  assert.equal(out.snapshots[0].date, '2026-11-20');
  assert.equal(h.filter((x) => x.symbol === 'VT').length, 1);
  assert.equal(h.find((x) => x.symbol.startsWith('T ')).assetClass, 'bonds');
  assert.equal(h.find((x) => x.symbol.startsWith('T ')).name, 'US T-BOND & NOTE');
  assert.deepEqual(h.filter((x) => x.assetClass === 'cash').map((x) => [x.currency, x.value]), [['USD', 200], ['EUR', 90]]);
});

test('fetchIbkrFlex polls until the statement is ready', async () => {
  const calls = [];
  const responses = [
    '<FlexStatementResponse><Status>Success</Status><ReferenceCode>R1</ReferenceCode><Url>https://x/GetStatement</Url></FlexStatementResponse>',
    '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress</ErrorMessage></FlexStatementResponse>',
    FLEX,
  ];
  const fetchImpl = async (url) => { calls.push(url); return { text: async () => responses.shift() }; };
  const out = await fetchIbkrFlex({ id: 'ibkr', queryId: '42' }, { token: 'TKN' }, { fetchImpl, pollMs: 1, log: () => {} });
  assert.equal(out.accounts[0].key, 'ibkr:U1');
  assert.match(calls[0], /SendRequest\?t=TKN&q=42&v=3/);
  assert.match(calls[2], /^https:\/\/x\/GetStatement\?t=TKN&q=R1/);
  await assert.rejects(fetchIbkrFlex({ id: 'i', queryId: '1' }, { token: 'bad' }, {
    fetchImpl: async () => ({ text: async () => '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>' }), log: () => {},
  }), /Token has expired/);
});

test('holdingsFromRows: finds header below a title, skips totals, guesses classes, agorot option', () => {
  const rows = [['דוח אחזקות'], [], ['שם נייר', 'מס\' נייר', 'כמות', 'שער', 'שווי'], ['תכלית סל', '1', '10', '2,000', '200'], ['אג"ח ממשלתי', '2', '100', '99', ''], ['סה"כ', '', '', '', '9999']];
  const r = holdingsFromRows(rows, {});
  assert.equal(r.holdings.length, 2);
  assert.equal(r.holdings[0].value, 200);
  assert.equal(r.holdings[1].value, 9900);
  assert.equal(r.holdings[1].assetClass, 'bonds');
  assert.equal(r.warnings.length, 1);
  assert.equal(holdingsFromRows(rows, { priceInAgorot: true }).holdings[1].value, 99);
  assert.equal(holdingsFromRows([['a', 'b'], ['1', '2']], {}), null);
});

test('pension: Excel rows and Mimshak XML', async () => {
  const rows = [['סוג מוצר', 'גוף מנהל', 'שם המוצר', 'מספר חשבון', 'סה"כ חיסכון'], ['קרן השתלמות', 'אלטשולר', 'כללי', '1', '100,000'], ['קרן פנסיה', 'מגדל', 'מקפת', '2', '50,000']];
  const p = pensionsFromRows(rows);
  assert.deepEqual(p.map((x) => [x.assetClass, x.balance]), [['hishtalmut', 100000], ['pension', 50000]]);
  const xml = `<?xml version="1.0" encoding="utf-8"?><Mimshak><YeshutYatzran><SHEM-YATZRAN>הראל</SHEM-YATZRAN><Mutzarim><Mutzar>
    <HeshbonotOPolisot><HeshbonOPolisa><MISPAR-POLISA-O-HESHBON>555</MISPAR-POLISA-O-HESHBON><SHEM-TOCHNIT>הראל השתלמות כללי</SHEM-TOCHNIT>
    <PerutYitrot><TOTAL-CHISACHON-MTZTBR>1000.5</TOTAL-CHISACHON-MTZTBR></PerutYitrot><PerutYitrot><TOTAL-CHISACHON-MTZTBR>500</TOTAL-CHISACHON-MTZTBR></PerutYitrot>
    </HeshbonOPolisa></HeshbonotOPolisot></Mutzar></Mutzarim></YeshutYatzran></Mimshak>`;
  const x = pensionsFromMimshakXml(xml);
  assert.deepEqual(x, [{ name: 'הראל – הראל השתלמות כללי', company: 'הראל', account: '555', assetClass: 'hishtalmut', balance: 1500.5 }]);
  const f = path.join(tmp(), 'm.xml'); fs.writeFileSync(f, xml);
  const res = await importPensionFile({ id: 'm' }, f, { date: '2026-01-01' });
  assert.equal(res.snapshots[0].balance, 1500.5);
});

test('CSV parsing: quotes, delimiters, windows-1255', async () => {
  assert.deepEqual(parseCsv('a;b\n"1;2";3\n'), [['a', 'b'], ['1;2', '3']]);
  const f = path.join(tmp(), 'h.csv');
  // "שם נייר,שווי\nתכלית,100" encoded as windows-1255
  const enc = (s) => Buffer.from([...s].map((c) => (c >= 'א' && c <= 'ת' ? c.charCodeAt(0) - 0x5d0 + 0xe0 : c.charCodeAt(0))));
  fs.writeFileSync(f, enc('שם נייר,שווי\nתכלית,100\n'));
  const [sheet] = await readTable(f);
  assert.deepEqual(sheet.rows, [['שם נייר', 'שווי'], ['תכלית', '100']]);
});

test('xlsx reading via exceljs', async () => {
  const f = path.join(tmp(), 'h.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('x');
  ws.addRow(['Name', 'Quantity', 'Price', 'Market Value']); ws.addRow(['VT', 2, 100, { formula: 'B2*C2', result: 200 }]);
  await wb.xlsx.writeFile(f);
  const [sheet] = await readTable(f);
  assert.equal(holdingsFromRows(sheet.rows, {}).holdings[0].value, 200);
});

test('fx: Bank of Israel parsing and conversion', () => {
  const rates = parseBoiRates({ exchangeRates: [{ key: 'USD', currentExchangeRate: 3.7, unit: 1 }, { key: 'JPY', currentExchangeRate: 2.5, unit: 100 }] });
  assert.deepEqual(rates, { USD: 3.7, JPY: 0.025 });
  const c = makeConverter({ rates });
  assert.equal(c(10, 'USD'), 37);
  assert.equal(c(10, '₪'), 10);
  c(1, 'GBP');
  assert.deepEqual([...c.missing], ['GBP']);
});

test('store: pending transactions are replaced on re-fetch; locked categories survive', () => {
  const s = new Store(tmp());
  s.mergeTransactions('a', [{ id: '1', accountKey: 'a', date: '2026-01-01', status: 'pending' }, { id: '2', accountKey: 'a', date: '2026-01-02', status: 'completed' }]);
  s.data.transactions.find((t) => t.id === '2').categoryLocked = true;
  s.data.transactions.find((t) => t.id === '2').category = 'X';
  const added = s.mergeTransactions('a', [{ id: '3', accountKey: 'a', date: '2026-01-01', status: 'completed' }, { id: '2', accountKey: 'a', date: '2026-01-02', status: 'completed' }]);
  assert.equal(added, 1);
  assert.deepEqual(s.data.transactions.map((t) => t.id).sort(), ['2', '3']);
  assert.equal(s.data.transactions.find((t) => t.id === '2').category, 'X');
});

test('analyze: transfers excluded; card payment counted as expense only when no card is connected', () => {
  const today = new Date('2026-03-15T12:00:00');
  const mk = () => { const s = new Store(tmp()); s.data.fx = { rates: {} }; return s; };
  const bankTx = [
    ['2026-01-01', 10000, 'משכורת'], ['2026-01-10', -3000, 'ישראכרט'], ['2026-01-15', -2000, 'העברה לחשבון השקעות'], ['2026-01-20', -500, 'שופרסל'],
    ['2026-02-01', 10000, 'משכורת'], ['2026-02-10', -3000, 'ישראכרט'],
  ].map(([date, chargedAmount, description], i) => ({ type: 'normal', identifier: i, date, processedDate: date, originalAmount: chargedAmount, originalCurrency: 'ILS', chargedAmount, description, status: 'completed' }));
  const s1 = mk();
  applyResult(s1, normalizeScrape({ id: 'b', company: 'hapoalim' }, { accounts: [{ accountNumber: '1', balance: 20000, txns: bankTx }] }, { today }));
  const a1 = analyze(s1, {}, { today });
  assert.deepEqual(a1.cashflow.map((c) => [c.month, c.income, c.expenses]), [['2026-01', 10000, 3500], ['2026-02', 10000, 3000]]);
  assert.ok(a1.categories.some((c) => c.category === 'כרטיס אשראי (לא מפורט)'));

  const s2 = mk();
  applyResult(s2, normalizeScrape({ id: 'b', company: 'hapoalim' }, { accounts: [{ accountNumber: '1', balance: 20000, txns: bankTx }] }, { today }));
  applyResult(s2, normalizeScrape({ id: 'c', company: 'isracard' }, { accounts: [{ accountNumber: '2', txns: [
    { type: 'normal', date: '2026-01-05', processedDate: '2026-02-10', originalAmount: -1200, originalCurrency: 'ILS', chargedAmount: -1200, description: 'WOLT', status: 'completed' },
  ] }] }, { today }));
  const a2 = analyze(s2, {}, { today });
  assert.deepEqual(a2.cashflow.map((c) => [c.month, c.expenses]), [['2026-01', 500], ['2026-02', 1200]]);
  // Jan-end: bank reconstructed backwards = 20000 - (Feb: +10000 -3000) = 13000,
  // minus the card purchase made Jan 5 but charged Feb 10 (-1200) = 11800
  const jan = a2.trend.find((p) => p.month === '2026-01');
  assert.equal(jan.value, 11800);
});

test('manual sources: assets and liabilities', () => {
  const s = new Store(tmp());
  syncManual(s, { sources: [{ id: 'home', type: 'manual', value: 1000000, assetClass: 'realEstate' }, { id: 'loan', type: 'manual', value: 200000, liability: true, monthlyPayment: 2000 }] }, '2026-01-01');
  const a = analyze(s, {}, { today: new Date('2026-01-02') });
  assert.equal(a.netWorth, 800000);
  assert.equal(a.liabilitiesTotal, -200000);
});

test('demo pipeline: analysis, report HTML and calculator export', async () => {
  const dir = tmp();
  const store = buildDemoStore(dir, new Date('2026-11-24T12:00:00'));
  const a = analyze(store, { fxRates: { USD: 3.72 } }, { today: new Date('2026-11-24T12:00:00') });
  assert.ok(a.netWorth > 0 && a.trend.length >= 5 && a.cashflow.length >= 6);
  const html = renderReport(a);
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.ok(!/https?:\/\/(?!www\.w3)/.test(html.replace(/xmlns="[^"]*"/g, '')), 'report must not load external resources');
  const f = path.join(dir, 'calc.xlsx');
  await exportCalculatorProfile(a, f);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['פרופיל', 'נכסים', 'התחייבויות']);
  const header = wb.getWorksheet('נכסים').getRow(1).values.slice(1);
  assert.deepEqual(header, ['מזהה', 'שם', 'סוג', 'סוג (תיאור)', 'שווי נוכחי', 'הפקדה חודשית', 'תשואה שנתית צפויה %']);
  const liab = wb.getWorksheet('התחייבויות');
  assert.equal(liab.rowCount, 2); // header + mortgage (card balance excluded)
});
