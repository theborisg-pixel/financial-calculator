// Pension / gemel / hishtalmut balances.
//  * XML from the Pension Clearinghouse (המסלקה הפנסיונית, "ממשק אחיד") — best-effort parser, see README.
//  * Excel/CSV summaries (Clearinghouse Excel, "הר הכסף", or any fund report) via column aliases.
import fs from 'node:fs';
import path from 'node:path';
import { readTable, findHeader } from './table.js';
import { blocks, text, decode } from '../xml.js';
import { parseNumber, isoDate, round2 } from '../util.js';
import { guessAssetClass } from '../assetClasses.js';

export const PENSION_ALIASES = {
  name: ['שם קופה', 'שם הקופה', 'שם המוצר', 'שם מוצר', 'שם תוכנית', 'שם התוכנית', 'שם הקרן', 'שם קרן', 'מסלול השקעה', 'שם מסלול'],
  company: ['גוף מנהל', 'שם גוף מנהל', 'חברה מנהלת', 'שם החברה', 'יצרן', 'שם יצרן'],
  type: ['סוג מוצר', 'סוג קופה', 'סוג המוצר', 'סוג תוכנית', 'מוצר'],
  account: ['מספר חשבון', 'מספר פוליסה', 'מספר פוליסה/חשבון', 'מס פוליסה', 'מספר עמית'],
  balance: ['יתרה', 'יתרה צבורה', 'סך חיסכון', 'סה"כ חיסכון', 'סך החיסכון', 'צבירה', 'סה"כ צבירה', 'יתרת חיסכון', 'סכום צבירה', 'סך צבירה', 'חיסכון מצטבר'],
  fee: ['דמי ניהול מצבירה', 'דמי ניהול מחיסכון', 'דמי ניהול'],
  monthly: ['הפקדה חודשית', 'הפקדות חודשיות', 'סך הפקדה חודשית'],
};

const productClass = (s) => guessAssetClass(s, 'pension');

export function pensionsFromRows(rows) {
  const hdr = findHeader(rows, PENSION_ALIASES, { minMatches: 2, required: ['balance'] });
  if (!hdr) return null;
  const { cols } = hdr;
  const out = [];
  for (const r of rows.slice(hdr.headerIndex + 1)) {
    const balance = parseNumber(r[cols.balance]);
    const label = [r[cols.company], r[cols.name]].filter(Boolean).map(String).join(' – ').trim();
    if (balance == null || !label || /^(סה"?כ|סך הכל)/.test(label)) continue;
    out.push({
      name: label, company: String(r[cols.company] ?? '').trim(), account: String(r[cols.account] ?? '').trim(),
      assetClass: productClass(`${r[cols.type] ?? ''} ${label}`), balance: round2(balance),
      fee: parseNumber(r[cols.fee]), monthlyContribution: parseNumber(r[cols.monthly]),
    });
  }
  return out;
}

// Mimshak XML: per policy/account block, take the plan name and the "TOTAL-CHISACHON-MTZTBR" (total accumulated savings) values.
export function pensionsFromMimshakXml(xml) {
  const out = [];
  const companies = blocks(xml, 'YeshutYatzran');
  for (const comp of (companies.length ? companies : [xml])) {
    const company = text(comp, 'SHEM-YATZRAN') || '';
    const products = blocks(comp, 'Mutzar');
    for (const prod of (products.length ? products : [comp])) {
      const accounts = blocks(prod, 'HeshbonOPolisa');
      for (const acc of (accounts.length ? accounts : [prod])) {
        const plan = text(acc, 'SHEM-TOCHNIT') || text(prod, 'SHEM-TOCHNIT') || '';
        const num = text(acc, 'MISPAR-POLISA-O-HESHBON') || '';
        const vals = [...acc.matchAll(/<TOTAL-CHISACHON-MTZTBR>([^<]*)<\/TOTAL-CHISACHON-MTZTBR>/g)].map((m) => parseNumber(decode(m[1])) || 0);
        if (!vals.length) continue;
        const balance = round2(vals.reduce((s, v) => s + v, 0));
        out.push({ name: [company, plan].filter(Boolean).join(' – ') || `חשבון ${num}`, company, account: num, assetClass: productClass(`${plan} ${company}`), balance });
      }
    }
  }
  return out;
}

export async function importPensionFile(source, file, { date = isoDate(new Date()) } = {}) {
  let items;
  if (path.extname(file).toLowerCase() === '.xml') {
    const buf = fs.readFileSync(file);
    let xml = buf.toString('utf8');
    if (/encoding="windows-1255"/i.test(xml.slice(0, 200))) xml = new TextDecoder('windows-1255').decode(buf);
    items = pensionsFromMimshakXml(xml);
  } else {
    for (const sheet of await readTable(file)) { items = pensionsFromRows(sheet.rows); if (items?.length) break; }
  }
  if (!items?.length) throw new Error(`No pension/gemel balances found in ${file}.`);
  const out = { accounts: [], snapshots: [], transactions: [] };
  items.forEach((it, i) => {
    const key = `${source.id}:${it.account || it.name || i}`;
    out.accounts.push({ key, sourceId: source.id, institution: it.company || source.label || 'פנסיה', kind: 'pension', currency: 'ILS', name: it.name, assetClass: it.assetClass, fee: it.fee ?? null, monthlyContribution: it.monthlyContribution ?? null });
    out.snapshots.push({ date, accountKey: key, balance: it.balance, currency: 'ILS' });
  });
  return out;
}
