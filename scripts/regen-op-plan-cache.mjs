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

let payload = null;
const res = {
  setHeader() {},
  status() { return this; },
  json(body) { payload = body; return this; },
  end() { return this; }
};
await opPlanHandler({ method: 'GET', query: {} }, res);

if (!payload || !payload.ok) throw new Error('handler failed: ' + JSON.stringify(payload));
const out = path.join(__dirname, '..', 'public', 'op-plan-cache.json');
await fs.writeFile(out, JSON.stringify(payload, null, 2));
const tacts = payload.goals.flatMap(g => g.children || []).flatMap(s => s.tacts || []);
const withCreator = tacts.filter(t => t.creator).length;
console.log(`Wrote ${out}: ${payload.goals.length} goals, ${tacts.length} tacts, ${withCreator} with creator`);
