// 一次性对拍（182 跑）：CD380 四修/BP42 pump 豁免票位置门
// ①CD 侧：0x28ad2c7d 07:15:55（NL20）/07:15:58（NL25）两锚 anchorMs=信号时刻真调
//   gateBuyPoint（persist:false），预期四修后=pump 臂移除恢复 CD379 豁免：
//   grade=healthy+exempt(activity_high)+levels.slowGrindPump≥3（引擎侧合成 pumpExempt=true）
//   （四修前=A 主判拒+exemptDenied:slow_grind_pump）
// ②BP 侧：opts.pumpExempt:true 真调——07:15:55（curVs≈+19 ≤40 放行 rule≠pump_exempt_gate）/
//   07:16:21（curVs≈+87 >40 拒 rule=pump_exempt_gate）+ 07:16:21 不传（对照 mapper 原样）
// 真调落 buy_point_analyses（版本=BP46 留痕，context.experimentId=bp42-parity）。
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9'; // bt-s02
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444'; // 让我们回到过去 HUILAO
const logger = { info() {}, warn() {}, error() {} };

function mkCheatSvc() {
  return new CheatCheckService({
    enabled: true,
    gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
    settleDelayMs: 0,
    memSource: { enabled: false },
    persist: false,
  }, logger, {});
}
function mkBpSvc() {
  return new BuyPointCheckService({
    enabled: true,
    gate: { awaitMs: 120000 },
    settleDelayMs: 0,
    persist: false,
  }, logger, {});
}

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error: e1 } = await client.from('strategy_signals')
    .select('id,created_at').eq('experiment_id', BT2).eq('signal_type', 'BUY')
    .eq('token_address', TOKEN).order('created_at');
  if (e1) throw e1;
  const at = (hhmmss) => {
    const r = sigs.find((s) => s.created_at.slice(11, 19) === hhmmss);
    if (!r) throw new Error(hhmmss + ' 信号行未找到');
    return Date.parse(r.created_at);
  };
  const { data: creates, error: e2 } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', TOKEN);
  if (e2) throw e2;
  const p = (creates[0] && creates[0].payload) || {};
  const meta = { address: TOKEN, symbol: p.symbol || 'HUILAO', name: p.name || null, platform: p.platform || 'fourmeme' };

  // ───── ①CD 侧：四修后 pump 臂移除=高活跃 pump strong 票恢复豁免 ─────
  console.log('===== CD 侧：CD380 四修 pump 臂移除对拍 =====');
  for (const hhmmss of ['07:15:55', '07:15:58']) {
    const anchorMs = at(hhmmss);
    const res = await mkCheatSvc().gateBuyPoint(TOKEN, meta, { experimentId: 'bp42-parity' },
      { awaitMs: 120000, anchorMs });
    const lv = (res && res.levels) || {};
    const ex = (res && res.exempt) || null;
    const denied = (res && res.exemptDenied) || null;
    const pumpExemptEngine = !!(ex && (lv.slowGrindPump ?? 0) >= 3); // 引擎 _cheatGateEvaluateBinary 同式合成
    console.log(`CD ${hhmmss} → grade=${res && res.grade} status=${res && res.status}` +
      ` exempt=${ex ? ex.code + '←' + ex.originalGrade : '无'} denied=${denied || '无'}` +
      ` slowGrindPump=${lv.slowGrindPump ?? '?'} burstSpike=${lv.burstSpikeConcentration ?? '?'}` +
      ` activity=${(res && res.buckets && res.buckets.activityLevel) || (res && res.activityLevel) || '?'}` +
      ` ⇒ 引擎 pumpExempt=${pumpExemptEngine}`);
  }

  // ───── ②BP 侧：位置门 ≤40 放行 / >40 拒 / 不传对照 ─────
  console.log('\n===== BP 侧：BP42 pumpExempt 位置门对拍 =====');
  const bp = mkBpSvc();
  for (const [hhmmss, pumpExempt, label] of [
    ['07:15:55', true, '15:55 pumpExempt(≤40 应放行)'],
    ['07:16:21', true, '16:21 pumpExempt(>40 应拒)'],
    ['07:16:21', undefined, '16:21 对照(不传=mapper 原样)'],
  ]) {
    const r = await bp.gateBuyPoint(TOKEN, meta, { experimentId: 'bp42-parity' },
      { anchorMs: at(hhmmss), ...(pumpExempt === true ? { pumpExempt: true } : {}) });
    const a = r.assessment || {};
    const an = r.anchors || {};
    const pat = (r.dimensions || {}).market_pattern || {};
    console.log(`${label} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'}` +
      ` pattern=${pat.bucket}(${pat.prob != null ? Number(pat.prob).toFixed(2) : '?'})` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
