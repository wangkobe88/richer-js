// 一次性诊断（182 跑）：0xa8e70ca0 用户质疑应为 retail_pvp——fresh gateBuyPoint 复判（锚=15:00:35 信号时刻）。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const EXP = '675c71a1-0e19-49b6-924b-facffc073afd';
const TOKEN = '0xa8e70ca07b68a07683c963513a26f2fa91647777';
const ANCHOR = Date.parse('2026-11-09T15:00:35.900Z'); // 买点观测时刻=信号锚

async function main() {
  const client = await dbManager.getClient();
  const { data: creates } = await client.from('wss_events').select('payload').eq('kind', 'token_create').eq('token_address', TOKEN).limit(1);
  const p = (creates && creates[0] && creates[0].payload) || {};
  const { data: etRows } = await client.from('experiment_tokens').select('platform').eq('experiment_id', EXP).eq('token_address', TOKEN).limit(1);
  const meta = { address: TOKEN, symbol: p.symbol || null, name: p.name || null, platform: (etRows && etRows[0] && etRows[0].platform) || p.platform || 'fourmeme' };

  const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, { info() {}, warn() {}, error() {} }, {});
  const r = await bp.gateBuyPoint(TOKEN, meta, { experimentId: 'bp58-a8e70-diag' }, { anchorMs: ANCHOR });
  const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
  const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
  console.log(`fresh 复判 → ${r.status} 综=${a.bucket}(${a.rule}) pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')} heat=${dim('market_heat')} holder=${dim('holder_concentration')} v=${r.questionVersion}`);
  console.log(`锚: curVs=${an.currentVsLaunchPct} curVsAth=${an.currentVsAthPct} chg30=${an.chg30Pct} nUp5=${an.nearMaxUp5Pct} nDn5=${an.nearMaxDn5Pct} minGap=${an.curVsMinGapPct} ticks=${an.anchorTickCount}`);
  const sd = r.stateDigest || r.digest || '';
  const wIdx = typeof sd === 'string' ? sd.indexOf('[WALLETS]') : -1;
  if (wIdx >= 0) console.log(`[WALLETS] 段:\n${sd.slice(wIdx, wIdx + 2000)}`);
  const oIdx = typeof sd === 'string' ? sd.indexOf('开盘段结构') : -1;
  if (oIdx >= 0) console.log(`开盘段:\n${sd.slice(Math.max(0, oIdx - 100), oIdx + 600)}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
