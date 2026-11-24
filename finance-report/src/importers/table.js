// Read CSV / XLSX exports into a 2-D array of cell values, and locate a header row by column aliases.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { normalizeHeader } from '../util.js';

export function parseCsv(textIn) {
  const t = textIn.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t', '|'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/** Returns an array of sheets: [{ name, rows: any[][] }]. */
export async function readTable(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    const buf = fs.readFileSync(file);
    let txt = buf.toString('utf8');
    if (txt.includes('�')) txt = new TextDecoder('windows-1255').decode(buf); // older Hebrew exports
    return [{ name: path.basename(file), rows: parseCsv(txt) }];
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    return wb.worksheets.map((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const vals = r.values.slice(1).map(cellValue);
        rows.push(vals);
      });
      return { name: ws.name, rows };
    });
  }
  if (ext === '.xls') throw new Error('Old .xls format is not supported — open it in Excel/LibreOffice/Google Sheets and save as .xlsx or .csv.');
  throw new Error(`Unsupported file type ${ext} (use .csv or .xlsx)`);
}

/**
 * Find the header row: the first row (within the first 40) that matches at least `minMatches` of the column aliases.
 * aliases: { field: ['alias', ...] }. Returns { headerIndex, cols: { field: columnIndex } } or null.
 */
export function findHeader(rows, aliases, { minMatches = 2, required = [] } = {}) {
  const norm = Object.fromEntries(Object.entries(aliases).map(([f, list]) => [f, list.map(normalizeHeader)]));
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const headers = rows[i].map(normalizeHeader);
    const cols = {};
    for (const [field, list] of Object.entries(norm)) {
      // exact match first, then "header starts with alias"
      let idx = headers.findIndex((h) => list.includes(h));
      if (idx < 0) idx = headers.findIndex((h) => h && list.some((a) => h.startsWith(a)));
      if (idx >= 0 && !Object.values(cols).includes(idx)) cols[field] = idx;
    }
    if (Object.keys(cols).length >= minMatches && required.every((r) => r in cols)) return { headerIndex: i, cols };
  }
  return null;
}
