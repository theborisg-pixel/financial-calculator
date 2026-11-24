// Normalized local data store (data/store.json).
//  accounts:     { [key]: { key, sourceId, institution, name, kind: 'bank'|'card'|'brokerage'|'pension'|'manual', currency, assetClass } }
//  snapshots:    [{ date, accountKey, balance, currency, estimated?, holdings?: [{ symbol, name, quantity, price, value, currency, assetClass }] }]
//  transactions: [{ id, accountKey, date, month, amount, currency, originalAmount, originalCurrency, description, memo, status, category, installments }]
//  fx:           { date, source, rates: { USD: 3.7, ... } }   (ILS per 1 unit)
import fs from 'node:fs';
import path from 'node:path';

export const emptyStore = () => ({ version: 1, accounts: {}, snapshots: [], transactions: [], fx: { rates: {} }, runs: [] });

export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'store.json');
    this.data = fs.existsSync(this.file) ? { ...emptyStore(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) } : emptyStore();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  upsertAccount(acc) {
    this.data.accounts[acc.key] = { ...(this.data.accounts[acc.key] || {}), ...acc };
  }
  /** One snapshot per account per day; a newer one replaces the older (and drops estimates for that day). */
  addSnapshot(snap) {
    this.data.snapshots = this.data.snapshots.filter((s) => !(s.accountKey === snap.accountKey && s.date === snap.date));
    this.data.snapshots.push(snap);
  }
  /** Replace an account's pending transactions and upsert the rest by id. Returns number of new transactions. */
  mergeTransactions(accountKey, txns) {
    const keep = this.data.transactions.filter((t) => !(t.accountKey === accountKey && t.status === 'pending'));
    const byId = new Map(keep.map((t) => [t.id, t]));
    let added = 0;
    for (const t of txns) {
      if (!byId.has(t.id)) added++;
      const prev = byId.get(t.id);
      byId.set(t.id, prev?.categoryLocked ? { ...t, category: prev.category, categoryLocked: true } : t);
    }
    this.data.transactions = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
    return added;
  }
}
