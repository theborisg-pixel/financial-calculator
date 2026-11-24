// Orchestrates fetching from every configured source into the store.
import path from 'node:path';
import { Vault } from './vault.js';
import { fetchIsraeliBank } from './connectors/israeliBank.js';
import { fetchIbkrFlex } from './connectors/ibkrFlex.js';
import { importHoldingsFile } from './importers/holdings.js';
import { importPensionFile } from './importers/pension.js';
import { refreshRates } from './fx.js';
import { isoDate } from './util.js';

export const FETCHABLE = new Set(['israeli-bank', 'ibkr-flex']);
export const IMPORTABLE = { 'holdings-file': importHoldingsFile, 'pension-file': importPensionFile };

export const vaultFor = (cfg) => new Vault(path.join(cfg.dataDir, 'vault.enc'));

export function applyResult(store, res) {
  for (const a of res.accounts) store.upsertAccount(a);
  for (const s of res.snapshots) store.addSnapshot(s);
  const byAcc = Map.groupBy(res.transactions, (t) => t.accountKey);
  let added = 0;
  for (const [key, txns] of byAcc) added += store.mergeTransactions(key, txns);
  return { accounts: res.accounts.length, snapshots: res.snapshots.length, newTransactions: added };
}

/** Manual entries from config (real estate, car, mortgage, loans…) are re-snapshotted on every run. */
export function syncManual(store, cfg, date = isoDate(new Date())) {
  for (const s of cfg.sources.filter((x) => x.type === 'manual' && !x.disabled)) {
    const key = `${s.id}:manual`;
    const value = Math.abs(Number(s.value) || 0) * (s.liability ? -1 : 1);
    store.upsertAccount({ key, sourceId: s.id, institution: s.institution || 'ידני', kind: 'manual', currency: s.currency || 'ILS', name: s.label || s.id, assetClass: s.liability ? 'liability' : s.assetClass || 'other', liability: !!s.liability, interestRate: s.interestRate, monthlyPayment: s.monthlyPayment, remainingMonths: s.remainingMonths, monthlyContribution: s.monthlyContribution });
    store.addSnapshot({ date, accountKey: key, balance: value, currency: s.currency || 'ILS' });
  }
}

export async function fetchAll(store, cfg, { ids = [], password, showBrowser = false, log = console.log } = {}) {
  const targets = cfg.sources.filter((s) => FETCHABLE.has(s.type) && !s.disabled && (!ids.length || ids.includes(s.id)));
  const secrets = targets.length ? vaultFor(cfg).read(password) : {};
  const summary = [];
  for (const s of targets) {
    log(`→ ${s.id} (${s.label || s.company || s.type})`);
    try {
      const creds = secrets[s.id];
      if (!creds) throw new Error(`no credentials saved — run: node bin/finreport.js creds set ${s.id}`);
      const res = s.type === 'israeli-bank'
        ? await fetchIsraeliBank(s, creds, { monthsBack: cfg.monthsBack ?? 6, showBrowser, log })
        : await fetchIbkrFlex(s, creds, { log });
      const r = applyResult(store, res);
      log(`  ✓ ${r.accounts} accounts, ${r.newTransactions} new transactions`);
      summary.push({ id: s.id, ok: true, ...r });
    } catch (e) {
      log(`  ✗ ${e.message}`);
      summary.push({ id: s.id, ok: false, error: e.message });
    }
    store.save(); // persist after each source so a later failure loses nothing
  }
  syncManual(store, cfg);
  await refreshRates(store, cfg, { log });
  store.data.runs.push({ at: new Date().toISOString(), summary });
  store.data.runs = store.data.runs.slice(-50);
  store.save();
  return summary;
}
