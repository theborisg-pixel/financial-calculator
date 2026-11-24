// Excel exports: (1) a full data workbook, (2) a profile workbook that the "מחשבון העתיד הפיננסי" calculator can import.
import ExcelJS from 'exceljs';
import { ASSET_CLASSES } from './assetClasses.js';

function addSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([key, header, width = 16]) => ({ key, header, width }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  return ws;
}

export async function exportDataWorkbook(a, file) {
  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'סיכום', [['k', 'מדד', 28], ['v', 'ערך', 18]], [
    { k: 'תאריך', v: a.today }, { k: 'שווי נקי', v: a.netWorth }, { k: 'נכסים', v: a.assetsTotal }, { k: 'התחייבויות', v: a.liabilitiesTotal },
    { k: 'הכנסה חודשית ממוצעת', v: a.avgIncome }, { k: 'הוצאה חודשית ממוצעת', v: a.avgExpenses }, { k: 'שיעור חיסכון', v: a.savingsRate },
  ]);
  addSheet(wb, 'חשבונות', [['name', 'חשבון', 32], ['institution', 'מוסד', 20], ['kind', 'סוג'], ['assetClass', 'סוג נכס'], ['currency', 'מטבע', 8], ['asOf', 'עדכון', 12], ['value', 'שווי בש"ח']], a.accounts);
  addSheet(wb, 'אחזקות', [['name', 'נייר', 36], ['symbol', 'סימול'], ['account', 'חשבון', 28], ['assetClass', 'סוג נכס'], ['quantity', 'כמות'], ['price', 'מחיר'], ['currency', 'מטבע', 8], ['value', 'שווי במטבע'], ['valueILS', 'שווי בש"ח']], a.holdings);
  addSheet(wb, 'תזרים חודשי', [['month', 'חודש', 10], ['income', 'הכנסות'], ['expenses', 'הוצאות'], ['net', 'נטו']], a.cashflow);
  addSheet(wb, 'קטגוריות', [['category', 'קטגוריה', 26], ['last', 'חודש אחרון'], ['avg', 'ממוצע 3 חודשים']], a.categories);
  addSheet(wb, 'שווי נקי', [['month', 'חודש', 10], ['value', 'שווי נקי'], ['estimated', 'הערכה']], a.trend);
  addSheet(wb, 'תנועות', [['date', 'תאריך', 12], ['account', 'חשבון', 26], ['description', 'תיאור', 36], ['category', 'קטגוריה', 20], ['amountILS', 'סכום בש"ח'], ['currency', 'מטבע', 8], ['status', 'סטטוס', 10]], a.transactions || []);
  await wb.xlsx.writeFile(file);
}

/**
 * Calculator profile (format version 3 of index.html's import). Uses the "פרופיל" sheet's legacy cashflow keys
 * (monthlyIncome / monthlyExpenses) so incomes don't need age ranges, plus "נכסים" and "התחייבויות" sheets.
 * Assets are grouped by asset class; liabilities come from manual entries.
 */
export function calculatorProfileData(a, { name = 'מהדוח הפיננסי' } = {}) {
  const assets = a.allocation.map((x, i) => ({
    id: `fr-${x.key}`, name: x.label, type: ASSET_CLASSES[x.key] ? x.key : 'other', typeLabel: ASSET_CLASSES[x.key]?.label || x.label,
    value: Math.round(x.value), monthlyContribution: 0, annualReturn: ASSET_CLASSES[x.key]?.ret ?? 4, _order: i,
  }));
  // Card balances are short-term and already part of monthly spending, so only real loans go to the calculator.
  const liabilities = a.accounts.filter((r) => r.value < 0 && r.kind !== 'card').map((r) => ({
    id: `fr-${r.key}`.replace(/[^\w-]/g, '-'), name: r.name, balance: Math.round(-r.value),
    interestRate: r.interestRate ?? 0, monthlyPayment: r.monthlyPayment ?? 0, remainingMonths: r.remainingMonths ?? 0,
  }));
  // The calculator adds loan repayments as automatic expenses; they are already inside the bank-derived average.
  const loanPayments = liabilities.reduce((s, l) => s + (Number(l.monthlyPayment) || 0), 0);
  const monthlyExpenses = Math.max(0, Math.round(a.avgExpenses - loanPayments));
  const profile = [
    ['_name', 'שם הפרופיל', name], ['_version', 'גרסת פורמט', 3], ['_updatedAt', 'עודכן', new Date().toISOString()],
    ['age', 'גיל נוכחי', ''], ['retirementAge', 'גיל פרישה', ''], ['lifeExpectancy', 'תכנון עד גיל', ''], ['inflation', 'אינפלציה שנתית %', ''],
    ['monthlyIncome', 'הכנסה חודשית', Math.round(a.avgIncome)], ['monthlyExpenses', 'הוצאה חודשית (ללא החזרי הלוואות)', monthlyExpenses],
  ];
  return { profile, assets, liabilities };
}

export async function exportCalculatorProfile(a, file, opts) {
  const { profile, assets, liabilities } = calculatorProfileData(a, opts);
  const wb = new ExcelJS.Workbook();
  wb.views = [{ rightToLeft: true }];
  const p = wb.addWorksheet('פרופיל', { views: [{ rightToLeft: true }] });
  p.addRow(['מפתח', 'שדה', 'ערך']); profile.forEach((r) => p.addRow(r));
  p.columns = [{ width: 26 }, { width: 44 }, { width: 18 }];
  addSheet(wb, 'נכסים', [['id', 'מזהה'], ['name', 'שם', 28], ['type', 'סוג'], ['typeLabel', 'סוג (תיאור)', 24], ['value', 'שווי נוכחי'], ['monthlyContribution', 'הפקדה חודשית'], ['annualReturn', 'תשואה שנתית צפויה %']], assets);
  addSheet(wb, 'התחייבויות', [['id', 'מזהה'], ['name', 'שם', 28], ['balance', 'יתרה'], ['interestRate', 'ריבית שנתית %'], ['monthlyPayment', 'החזר חודשי'], ['remainingMonths', 'תשלומים שנותרו (חודשים)']], liabilities);
  await wb.xlsx.writeFile(file);
}
