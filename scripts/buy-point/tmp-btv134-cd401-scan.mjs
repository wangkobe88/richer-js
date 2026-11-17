// R5 定线扫描：btv134 全部 BUY 信号行 burstWaveSeg 锚分布（182 跑）
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');

const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
const c = await dbManager.getClient();
const data = [];
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await c.from('strategy_signals')
    .select('id,token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  data.push(...page);
  if (page.length < 1000) break;
}

const out = [];
for (const s of data || []) {
  const cc = (s.metadata || {}).cheatCheck;
  if (!cc) continue;
  const a = cc.anchors || {};
  const lv = cc.levels || {};
  out.push({
    token: s.token_address, symbol: s.token_symbol, at: s.created_at,
    grade: cc.grade, exempt: cc.exempt ? cc.exempt.code : null,
    sbw: lv.stallBurstWave ?? null, sbwB: (cc.buckets || {}).stallBurstWave ?? null,
    act: (cc.buckets || {}).activityLevel ?? null,
    segSellPct: a.burstWaveSegSellPct ?? null, segSellBnb: a.burstWaveSegSellBnb ?? null,
    segBuyBnb: a.burstWaveSegBuyBnb ?? null,
    exitBuyBnb: a.burstExitSegBuyBnb ?? null, exitSellBnb: a.burstExitSegSellBnb ?? null, exitSellPct: a.burstExitSegSellPct ?? null,
    preSegBnbPerMin: a.burstPreSegBnbPerMin ?? null, preSegTicksPerMin: a.burstPreSegTicksPerMin ?? null,
  });
}
writeFileSync('/tmp/btv134-cd401-scan.json', JSON.stringify(out));
console.log(`rows=${out.length} → /tmp/btv134-cd401-scan.json`);
