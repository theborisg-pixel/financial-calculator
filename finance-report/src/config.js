import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG_PATH = process.env.FINREPORT_CONFIG || path.resolve('config.json');

export function loadConfig(file = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(file)) {
    throw new Error(`Config not found: ${file}\nRun "node bin/finreport.js init" to create one from config.example.json.`);
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = path.dirname(path.resolve(file));
  cfg.dataDir = path.resolve(base, cfg.dataDir || 'data');
  cfg.sources = cfg.sources || [];
  const ids = new Set();
  for (const s of cfg.sources) {
    if (!s.id || !s.type) throw new Error(`Every source needs "id" and "type": ${JSON.stringify(s)}`);
    if (ids.has(s.id)) throw new Error(`Duplicate source id "${s.id}"`);
    ids.add(s.id);
  }
  return cfg;
}

export function getSource(cfg, id) {
  const s = cfg.sources.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source "${id}". Known: ${cfg.sources.map((x) => x.id).join(', ') || '(none)'}`);
  return s;
}
