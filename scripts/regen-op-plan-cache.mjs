import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import opPlanHandler from '../api/op-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
try {
  const envContent = await fs.readFile(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) {
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[t.slice(0, i).trim()] = v;
    }
  }
} catch { console.log('no .env'); }

async function regen(group, file) {
  let payload = null;
  const res = {
    setHeader() {},
    status() { return this; },
    json(body) { payload = body; return this; },
    end() { return this; }
  };
  await opPlanHandler({ method: 'GET', query: group ? { group } : {} }, res);
  if (!payload || !payload.ok) throw new Error(`handler failed (group ${group || 51}): ` + JSON.stringify(payload));
  const out = path.join(__dirname, '..', 'public', file);
  await fs.writeFile(out, JSON.stringify(payload, null, 2));
  const tacts = payload.goals.flatMap(g => g.children || []).flatMap(s => s.tacts || []);
  const withCreator = tacts.filter(t => t.creator).length;
  console.log(`Wrote ${out}: ${payload.goals.length} goals, ${tacts.length} tacts, ${withCreator} with creator`);
}

// 51 — ОП 2026 (по умолчанию), 57 — ERP Платформа.
await regen(null, 'op-plan-cache.json');
await regen('57', 'op-plan-cache-57.json');
