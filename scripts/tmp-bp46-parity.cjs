#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP46 定向对拍——黄金点豁免奔零臂
// 主：0x28ad2c7d 07:15:45 ×3（预期 pullback poor 0.53→neutral ≥0.5、综 any_neutral）
// 副：07:15:55 ×2（NL20 信号锚，区内 +18.4）
// 反例：07:14:21 ×2（curVs +23.7 区外=奔零臂照常评估）+07:16:21 ×1（拉离照拒）
// 注意：真调落 buy_point_analyses（版本=BP46 留痕）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');

  const { data: sigs, error } = await db.from('strategy_signals')
    .select('created_at').eq('experiment_id', BT2).eq('signal_type', 'BUY')
    .eq('token_address', TOKEN).order('created_at');
  if (error) throw new Error(error.message);
  const at = (hhmmss) => {
    const r = sigs.find((s) => s.created_at.slice(11, 19) === hhmmss);
    if (!r) throw new Error(hhmmss + ' 信号行未找到');
    return Date.parse(r.created_at);
  };

  const svc = new BuyPointCheckService(
    { enabled: true, timeoutMs: 60000, gate: { awaitMs: 60000 }, minTicks: 8, settleDelayMs: 1 },
    { info() {}, warn() {}, error() {} },
    {},
  );

  const first = await svc.gateBuyPoint(TOKEN, { symbol: 'HUILAO', name: '让我们回到过去', platform: 'fourmeme' }, {}, { anchorMs: at('07:15:45') });
  console.log('result keys=' + Object.keys(first).join(','));

  async function run(hhmmss, label, n) {
    const anchorMs = at(hhmmss);
    for (let i = 1; i <= n; i++) {
      const r = await svc.gateBuyPoint(TOKEN, { symbol: 'HUILAO', name: '让我们回到过去', platform: 'fourmeme' }, {}, { anchorMs });
      const a = r.assessment || {};
      const pat = (r.dimensions || {}).market_pattern || {};
      const qs = r.qualities || (r.snapshotDigest || {}).qualities || {};
      const pb = qs.pullback_entry_quality || {};
      const eb = qs.early_bird_quality || {};
      const an = r.anchors || {};
      console.log(`${label}#${i} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'} pattern=${pat.bucket}(${pat.prob != null ? Number(pat.prob).toFixed(2) : '?'}) pullback=${pb.bucket ?? '?'}(${pb.prob != null ? Number(pb.prob).toFixed(2) : '?'}) early=${eb.bucket ?? '?'}(${eb.prob != null ? Number(eb.prob).toFixed(2) : '?'}) curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
    }
  }

  await run('07:15:45', '主 15:45', 3);
  await run('07:15:55', '副 15:55', 2);
  await run('07:14:21', '反例 14:21(区外)', 2);
  await run('07:16:21', '反例 16:21(拉离)', 1);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
