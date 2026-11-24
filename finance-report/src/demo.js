// Deterministic sample data so the whole pipeline can be tried without any real account.
import { Store } from './store.js';
import { normalizeScrape } from './connectors/israeliBank.js';
import { parseFlexStatement } from './connectors/ibkrFlex.js';
import { holdingsFromRows } from './importers/holdings.js';
import { pensionsFromRows } from './importers/pension.js';
import { applyResult, syncManual } from './sources.js';
import { isoDate } from './util.js';

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

export const DEMO_CONFIG = {
  sources: [
    { id: 'hapoalim', type: 'israeli-bank', company: 'hapoalim', label: 'בנק הפועלים' },
    { id: 'max', type: 'israeli-bank', company: 'max', label: 'מקס' },
    { id: 'ibkr', type: 'ibkr-flex', label: 'Interactive Brokers', queryId: '000000' },
    { id: 'meitav', type: 'holdings-file', label: 'מיטב טרייד' },
    { id: 'mislaka', type: 'pension-file', label: 'מסלקה פנסיונית' },
    { id: 'apartment', type: 'manual', label: 'דירה', assetClass: 'realEstate', value: 2450000 },
    { id: 'mortgage', type: 'manual', label: 'משכנתא', liability: true, value: 980000, interestRate: 4.6, monthlyPayment: 5400, remainingMonths: 236 },
  ],
  fxRates: { USD: 3.72, EUR: 3.98 },
};

export function buildDemoStore(dataDir, today = new Date()) {
  const r = rng(42);
  const store = new Store(dataDir);
  store.data = { version: 1, accounts: {}, snapshots: [], transactions: [], fx: { date: isoDate(today), source: 'demo', rates: DEMO_CONFIG.fxRates }, runs: [] };
  const cfg = DEMO_CONFIG;
  const months = 8;
  const day = (mBack, d) => { const x = new Date(today.getFullYear(), today.getMonth() - mBack, d); return x > today ? null : x.toISOString(); };

  // bank: salary, rent-like items, card payments, transfers
  const bankTx = []; const cardTx = [];
  const merchants = [['שופרסל דיל', 180, 650], ['רמי לוי שיווק השקמה', 150, 520], ['WOLT', 60, 180], ['ארומה', 25, 70], ['פז', 200, 350], ['סופר-פארם', 40, 220], ['NETFLIX.COM', 55, 55], ['SPOTIFY', 24, 24], ['פרטנר תקשורת', 89, 89], ['רב קו', 50, 150], ['AMAZON MKTPLACE', 80, 600], ['איקאה נתניה', 100, 900], ['מכבי שירותי בריאות', 30, 120], ['קפה גרג', 30, 90], ['חניון אחוזת בית', 15, 40]];
  for (let m = months - 1; m >= 0; m--) {
    let cardTotal = 0;
    const n = 28 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const [d, lo, hi] = merchants[Math.floor(r() * merchants.length)];
      const date = day(m, 1 + Math.floor(r() * 27)); if (!date) continue;
      const amt = -Math.round(lo + r() * (hi - lo));
      cardTotal += amt;
      const charge = new Date(today.getFullYear(), today.getMonth() - m + 1, 10).toISOString();
      cardTx.push({ type: 'normal', identifier: `${m}-${i}`, date, processedDate: charge, originalAmount: amt, originalCurrency: 'ILS', chargedAmount: amt, description: d, status: 'completed' });
    }
    const push = (dd, amount, description) => { const date = day(m, dd); if (date) bankTx.push({ type: 'normal', identifier: `${m}-${description}`, date, processedDate: date, originalAmount: amount, originalCurrency: 'ILS', chargedAmount: amount, description, status: 'completed' }); };
    push(1, 24500 + Math.round(r() * 800), 'משכורת');
    push(2, -5400, 'משכנתא לאומי למשכנתאות');
    push(5, -420, 'חברת החשמל');
    push(6, -890, 'עיריית תל אביב ארנונה');
    push(8, -1350, 'הראל ביטוח');
    push(10, -Math.round(-cardTotal * 0.98), 'מקס איט פיננסים');
    push(12, -2800, 'גן ילדים שושנים');
    push(15, -5000, 'העברה לחשבון השקעות IBKR');
    if (m % 3 === 1) push(20, -1900, 'אל על נתיבי אויר');
    if (m === 2) push(18, 3200, 'החזר מס הכנסה');
  }
  const bankResult = { success: true, accounts: [{ accountNumber: '12-345-678901', balance: 48250, txns: bankTx }] };
  applyResult(store, normalizeScrape(cfg.sources[0], bankResult, { today }));
  applyResult(store, normalizeScrape(cfg.sources[1], { success: true, accounts: [{ accountNumber: '4580', txns: cardTx }] }, { today }));

  // IBKR: snapshots for the last few months (growing portfolio)
  for (let m = 5; m >= 0; m--) {
    const d = new Date(today.getFullYear(), today.getMonth() - m + (m ? 1 : 0), m ? 0 : today.getDate());
    const g = 1 + (5 - m) * 0.018;
    const ymd = isoDate(d).replace(/-/g, '');
    const xml = `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1234567" fromDate="${ymd}" toDate="${ymd}">
      <AccountInformation accountId="U1234567" currency="USD"/>
      <OpenPositions>
        <OpenPosition symbol="VT" description="VANGUARD TOT WORLD STK ETF" assetCategory="STK" currency="USD" position="${300 + (5 - m) * 12}" markPrice="${(118 * g).toFixed(2)}" positionValue="${((300 + (5 - m) * 12) * 118 * g).toFixed(2)}" levelOfDetail="SUMMARY"/>
        <OpenPosition symbol="CSPX" description="ISHARES CORE S&amp;P 500" assetCategory="STK" currency="USD" position="40" markPrice="${(610 * g).toFixed(2)}" positionValue="${(40 * 610 * g).toFixed(2)}" levelOfDetail="SUMMARY"/>
        <OpenPosition symbol="BND" description="VANGUARD TOTAL BOND MARKET" assetCategory="STK" currency="USD" position="120" markPrice="73.10" positionValue="8772" levelOfDetail="SUMMARY"/>
      </OpenPositions>
      <CashReport><CashReportCurrency currency="BASE_SUMMARY" endingCash="2400"/><CashReportCurrency currency="USD" endingCash="2400"/></CashReport>
    </FlexStatement></FlexStatements></FlexQueryResponse>`;
    applyResult(store, parseFlexStatement(xml, cfg.sources[2]));
  }

  // Israeli broker export (as parsed from a CSV)
  const meitav = holdingsFromRows([
    ['דוח אחזקות', '', '', '', ''],
    ['שם נייר', 'מספר נייר', 'כמות', 'שער', 'שווי בש"ח'],
    ['תכלית סל ת"א 125', '1143718', '850', '2,315', '19,677.50'],
    ['הראל מחקה S&P 500', '5130919', '1,200', '3,410', '40,920'],
    ['אג"ח ממשלתי שקלי 0327', '1139344', '25,000', '98.6', '24,650'],
    ['מיטב קרן כספית', '5111111', '30000', '1.02', '30,600'],
    ['סה"כ', '', '', '', '115,847.50'],
  ], { assetClass: 'stocks' });
  applyResult(store, { accounts: [{ key: 'meitav:portfolio', sourceId: 'meitav', institution: 'מיטב טרייד', kind: 'brokerage', currency: 'MIXED', name: 'מיטב טרייד', assetClass: 'stocks' }], snapshots: [{ date: isoDate(today), accountKey: 'meitav:portfolio', balance: null, currency: 'MIXED', holdings: meitav.holdings }], transactions: [] });

  // Pension clearinghouse summary
  const pens = pensionsFromRows([
    ['סוג מוצר', 'גוף מנהל', 'שם המוצר', 'מספר חשבון', 'סה"כ חיסכון', 'דמי ניהול מצבירה'],
    ['קרן פנסיה מקיפה', 'מגדל', 'מגדל מקפת אישית', '778812', '612,340', '0.22%'],
    ['קרן השתלמות', 'אלטשולר שחם', 'השתלמות מסלול כללי', '55120', '184,900', '0.65%'],
    ['קופת גמל להשקעה', 'מור', 'מור גמל להשקעה מניות', '30091', '96,450', '0.6%'],
  ]);
  pens.forEach((it) => {
    const key = `mislaka:${it.account}`;
    store.upsertAccount({ key, sourceId: 'mislaka', institution: it.company, kind: 'pension', currency: 'ILS', name: it.name, assetClass: it.assetClass });
    for (let m = 5; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m + (m ? 1 : 0), m ? 0 : today.getDate());
      store.addSnapshot({ date: isoDate(d), accountKey: key, balance: Math.round(it.balance * (1 - m * 0.009)), currency: 'ILS' });
    }
  });

  // manual entries, snapshotted at each month end so the trend includes them
  for (let m = 5; m >= 0; m--) syncManual(store, cfg, isoDate(new Date(today.getFullYear(), today.getMonth() - m + (m ? 1 : 0), m ? 0 : today.getDate())));
  return store;
}
