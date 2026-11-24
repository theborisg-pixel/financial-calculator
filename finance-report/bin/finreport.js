#!/usr/bin/env node
// finreport — collect balances, holdings and transactions from Israeli banks, cards, brokers and pension funds into one local report.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getSource, DEFAULT_CONFIG_PATH } from '../src/config.js';
import { Store } from '../src/store.js';
import { masterPassword, ask } from '../src/prompt.js';
import { fetchAll, syncManual, vaultFor, IMPORTABLE, applyResult } from '../src/sources.js';
import { loginFieldsFor } from '../src/connectors/israeliBank.js';
import { analyze } from '../src/analyze.js';
import { renderReport } from '../src/report.js';
import { exportDataWorkbook, exportCalculatorProfile } from '../src/export.js';
import { buildDemoStore, DEMO_CONFIG } from '../src/demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

const HELP = `
finreport <command>

  init                       create config.json from config.example.json
  creds set <sourceId>       save login details for a source (encrypted with your master password)
  creds list                 list sources that have saved credentials
  creds remove <sourceId>    delete saved credentials
  fetch [sourceId ...]       pull data from banks / cards / IBKR   (--show-browser to watch the login)
  import <sourceId> <file>   import a broker holdings or pension export (.csv / .xlsx / .xml)
  report                     build data/report.html + Excel exports
  demo                       build a report from sample data in data-demo/

Master password: prompted, or set FINREPORT_PASSWORD.  Config: ${path.relative(process.cwd(), DEFAULT_CONFIG_PATH)} (FINREPORT_CONFIG to override).
`;

async function buildOutputs(store, cfg, outDir) {
  const a = analyze(store, cfg);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const html = path.join(outDir, 'report.html');
  fs.writeFileSync(html, renderReport(a, { title: cfg.title || 'דוח פיננסי אישי' }), { mode: 0o600 });
  await exportDataWorkbook(a, path.join(outDir, 'finance-data.xlsx'));
  await exportCalculatorProfile(a, path.join(outDir, 'calculator-profile.xlsx'), { name: cfg.calculatorProfileName });
  for (const f of ['finance-data.xlsx', 'calculator-profile.xlsx']) fs.chmodSync(path.join(outDir, f), 0o600);
  console.log(`\nשווי נקי: ₪${Math.round(a.netWorth).toLocaleString('en-US')}   נכסים: ₪${Math.round(a.assetsTotal).toLocaleString('en-US')}   התחייבויות: ₪${Math.round(-a.liabilitiesTotal).toLocaleString('en-US')}`);
  for (const w of a.warnings) console.log(`  ! ${w}`);
  console.log(`\nReport:            ${html}\nData workbook:     ${path.join(outDir, 'finance-data.xlsx')}\nCalculator import: ${path.join(outDir, 'calculator-profile.xlsx')}`);
}

async function main() {
  switch (cmd) {
    case 'init': {
      if (fs.existsSync(DEFAULT_CONFIG_PATH)) return console.log(`${DEFAULT_CONFIG_PATH} already exists.`);
      fs.copyFileSync(path.join(ROOT, 'config.example.json'), DEFAULT_CONFIG_PATH);
      return console.log(`Created ${DEFAULT_CONFIG_PATH}. Edit the "sources" list, then run: node bin/finreport.js creds set <id>`);
    }
    case 'creds': {
      const cfg = loadConfig();
      const vault = vaultFor(cfg);
      const [sub, id] = args;
      if (sub === 'list') {
        const secrets = vault.read(await masterPassword());
        return console.log(Object.keys(secrets).length ? Object.keys(secrets).map((k) => `  ${k}: ${Object.keys(secrets[k]).join(', ')}`).join('\n') : '(none)');
      }
      if (!id) throw new Error('Usage: creds set|remove <sourceId>');
      const src = getSource(cfg, id);
      const pw = await masterPassword({ confirm: !vault.exists() });
      const secrets = vault.read(pw);
      if (sub === 'remove') { delete secrets[id]; vault.write(secrets, pw); return console.log(`Removed credentials for ${id}.`); }
      if (sub !== 'set') throw new Error('Usage: creds set|remove|list');
      const fields = src.type === 'israeli-bank' ? await loginFieldsFor(src.company) : src.type === 'ibkr-flex' ? ['token'] : null;
      if (!fields) throw new Error(`Source type "${src.type}" does not need credentials.`);
      const creds = {};
      for (const f of fields) {
        const hidden = /password|token/i.test(f);
        const v = await ask(`${src.label || id} — ${f}${f === 'otpLongTermToken' ? ' (optional, Enter to skip)' : ''}: `, { hidden });
        if (v) creds[f] = v.trim();
      }
      secrets[id] = creds;
      vault.write(secrets, pw);
      return console.log(`Saved (encrypted) credentials for ${id} → ${vault.file}`);
    }
    case 'fetch': {
      const cfg = loadConfig();
      const store = new Store(cfg.dataDir);
      const needsPw = cfg.sources.some((s) => ['israeli-bank', 'ibkr-flex'].includes(s.type) && !s.disabled && (!args.length || args.includes(s.id)));
      const summary = await fetchAll(store, cfg, { ids: args, password: needsPw ? await masterPassword() : null, showBrowser: flags.has('--show-browser') });
      const failed = summary.filter((s) => !s.ok);
      if (!flags.has('--no-report')) await buildOutputs(store, cfg, cfg.dataDir);
      if (failed.length) process.exitCode = 2;
      return;
    }
    case 'import': {
      const [id, file] = args;
      if (!id || !file) throw new Error('Usage: import <sourceId> <file>');
      const cfg = loadConfig();
      const src = getSource(cfg, id);
      const importer = IMPORTABLE[src.type];
      if (!importer) throw new Error(`Source "${id}" is "${src.type}"; import works for: ${Object.keys(IMPORTABLE).join(', ')}`);
      const store = new Store(cfg.dataDir);
      const res = await importer(src, path.resolve(file));
      const r = applyResult(store, res);
      syncManual(store, cfg);
      store.save();
      console.log(`Imported ${r.snapshots} snapshot(s) into ${id}.`);
      for (const w of res.warnings || []) console.log(`  ! ${w}`);
      return buildOutputs(store, cfg, cfg.dataDir);
    }
    case 'report': {
      const cfg = loadConfig();
      const store = new Store(cfg.dataDir);
      syncManual(store, cfg);
      store.save();
      return buildOutputs(store, cfg, cfg.dataDir);
    }
    case 'demo': {
      const dir = path.join(ROOT, 'data-demo');
      const store = buildDemoStore(dir);
      store.save();
      return buildOutputs(store, { ...DEMO_CONFIG, title: 'דוח פיננסי אישי · נתוני דוגמה' }, dir);
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
