// 一次性（182 跑）v2：全部今日存档 digest+题档位 → /tmp/sbp-digests.json
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DATA = path.join(process.cwd(), 'scripts/cheat-detection/data');
const files = fs.readdirSync(DATA).filter(f => /^cd-run-2026-11-0[34]T/.test(f)).sort();
const QS = ['equal_amount_split','coordinated_sell_back','creator_front_run','sell_dispersion','stall_burst_wave','amount_tiering','same_block_buy_wave','activity_level','bundled_trade_dominance','insider_supply_sell','slow_grind_pump','wash_pair','holdings_balance','abnormal_behavior_ratio','burst_spike_concentration','strong_backer_pressure'];
const out = {};
for (const f of files) {
  const d = require(path.join(DATA, f));
  for (const r of d.results || []) {
    const levels = {};
    for (const q of QS) {
      const a = r.answersRaw && r.answersRaw[q];
      if (a) levels[q] = a.choice;
    }
    out[r.caseId] = { grade: r.grade, reasons: (r.gradeReasons || []).map(x => x.code || x), anchors: r.anchors || null, levels, from: f };
  }
}
fs.writeFileSync('/tmp/sbp-digests.json', JSON.stringify(out, null, 1));
console.log('票数', Object.keys(out).length);
