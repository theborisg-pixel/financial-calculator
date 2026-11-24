// Israeli banks & credit cards via the open-source `israeli-bank-scrapers` (logs in with your credentials in a headless Chrome).
import { hashId, isoDate, monthKey, round2 } from '../util.js';

const CARD_COMPANIES = new Set(['max', 'visaCal', 'isracard', 'amex', 'behatsdaa', 'beyahadBishvilha']);

async function lib() {
  try {
    return await import('israeli-bank-scrapers');
  } catch {
    throw new Error('israeli-bank-scrapers is not installed. Run "npm install" (it downloads a Chromium browser for logging in).');
  }
}

export async function loginFieldsFor(company) {
  const { SCRAPERS } = await lib();
  const def = SCRAPERS[company];
  if (!def) throw new Error(`Unknown company "${company}". Supported: ${Object.keys(SCRAPERS).join(', ')}`);
  // otpCodeRetriever is a callback, not a stored secret.
  return def.loginFields.filter((f) => f !== 'otpCodeRetriever');
}

export const isCardCompany = (company) => CARD_COMPANIES.has(company);

/** Convert a scraper result to normalized accounts / snapshots / transactions. Pure — unit tested. */
export function normalizeScrape(source, result, { today = new Date() } = {}) {
  const kind = isCardCompany(source.company) ? 'card' : 'bank';
  const todayIso = isoDate(today);
  const out = { accounts: [], snapshots: [], transactions: [] };
  for (const acc of result.accounts || []) {
    const key = `${source.id}:${acc.accountNumber}`;
    const currency = acc.currency || 'ILS';
    out.accounts.push({
      key, sourceId: source.id, institution: source.label || source.company, kind, currency,
      name: `${source.label || source.company} ${acc.accountNumber}`,
      assetClass: kind === 'card' ? 'liability' : acc.savingsAccount ? 'deposit' : 'cash',
    });
    const txns = (acc.txns || []).map((t) => {
      const charged = t.chargedAmount ?? t.originalAmount;
      // Card installments carry the purchase date; book them by the charge date.
      const bookDate = (kind === 'card' && t.processedDate) ? t.processedDate : t.date;
      return {
        id: hashId(key, t.identifier, t.date, t.processedDate, charged, t.description, t.installments?.number),
        accountKey: key,
        date: isoDate(bookDate),
        purchaseDate: isoDate(t.date),
        month: monthKey(isoDate(bookDate)),
        amount: round2(charged),
        currency: t.chargedCurrency || currency,
        originalAmount: t.originalAmount,
        originalCurrency: t.originalCurrency,
        description: (t.description || '').trim(),
        memo: t.memo || '',
        status: t.status || 'completed',
        installments: t.installments || null,
        scraperCategory: t.category || null,
      };
    });
    out.transactions.push(...txns);

    if (kind === 'card') {
      // Net worth: what is already spent but not yet charged to the bank is a liability.
      const upcoming = txns.filter((t) => t.date > todayIso).reduce((s, t) => s + t.amount, 0);
      out.snapshots.push({ date: todayIso, accountKey: key, balance: round2(Math.min(0, upcoming)), currency, note: 'חיובים עתידיים' });
    } else if (typeof acc.balance === 'number') {
      out.snapshots.push({ date: acc.balanceDate ? isoDate(acc.balanceDate) : todayIso, accountKey: key, balance: acc.balance, currency });
    }
  }
  return out;
}

export async function fetchIsraeliBank(source, credentials, { monthsBack = 6, showBrowser = false, log = console.log } = {}) {
  const { createScraper } = await lib();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);
  startDate.setDate(1);
  const scraper = createScraper({
    companyId: source.company,
    startDate,
    combineInstallments: false,
    showBrowser: showBrowser || !!source.showBrowser,
    futureMonthsToScrape: 1,
    ...(source.scraperOptions || {}),
  });
  scraper.onProgress((_, p) => p?.type && log(`    ${source.id}: ${p.type}`));
  const creds = { ...credentials };
  if (source.company === 'oneZero' && !creds.otpLongTermToken) {
    const { ask } = await import('../prompt.js');
    creds.otpCodeRetriever = () => ask('One Zero SMS code: ');
  }
  const result = await scraper.scrape(creds);
  if (!result.success) throw new Error(`${result.errorType || 'error'}: ${result.errorMessage || 'scrape failed'}`);
  return normalizeScrape(source, result);
}
