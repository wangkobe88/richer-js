// 一次性对拍（182 跑）：BP50 almost_launch 上界 20→10 + CD386 reset 判定腿 1.2→1.1。
// ①BP 侧 HUILAO 0x28ad2c7d 三锚（bt-s02=19ab9c37）：
//   07:15:45 黄金点锚（curVs 破发 ≤+10 → ⑧②腿新界下仍成立）
//   07:15:55 curVs≈+19 —— **关键翻转带票**：+10<19≤20 旧界在 almost 区内可判⑧、
//     新界 >+10 不再⑧ → 预期落⑦（reset 仍触发则 minVs ≤+10）→ RESTART 门 ≤40 放行
//     → 终态预期仍 neutral gates_passed（桶路径⑧→⑦、门结果不变）
//   07:16:21 curVs≈+87 拉离 → 照拒（pump_exempt_gate/pattern_gate 维持）
// ②苍蝇两锚 05:10:06/09（cangying-bp42-v2=608df82f，curVs≈+32 不在任何 almost 域）
//   —— 判读稳定性+题面改后无 max_tokens 超限验证（BP47 起稳定④拒）
// ③CD 侧 HUILAO 07:15:55 cheat 门真调：digest.marketReset 预期仍 1（涨起后最低深破发
//   ≤+10 远低于新旧界——1.2→1.1 对本票零翻转=接线验证；翻转带票交给 bt-v87 回测）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const BT2 = '19ab9c37-771c-483e-93ad-7137550c44d9'; // bt-s02
const CY = '608df82f-73c5-4714-bc4a-df099bbfd81c'; // cangying-bp42-v2
const HUILAO = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const CANGYING = '0xb30f0b8a8270271989e37d6bc00e627a07637777';
const logger = { info() {}, warn() {}, error() {} };

function mkBpSvc() {
  return new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});
}
function mkCheatSvc() {
  return new CheatCheckService({
    enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
    settleDelayMs: 0, memSource: { enabled: false }, persist: false,
  }, logger, {});
}

async function sigAt(client, exp, token, hhmmss) {
  const { data, error } = await client.from('strategy_signals')
    .select('id,created_at').eq('experiment_id', exp).eq('signal_type', 'BUY')
    .eq('token_address', token).order('created_at');
  if (error) throw new Error(error.message);
  const r = data.find((s) => s.created_at.slice(11, 19) === hhmmss);
  if (!r) throw new Error(hhmmss + ' 信号行未找到');
  return Date.parse(r.created_at);
}
async function tokenMeta(client, token, dftSymbol, dftPlatform) {
  const { data } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', token);
  const p = (data[0] && data[0].payload) || {};
  return { address: token, symbol: p.symbol || dftSymbol, name: p.name || null, platform: p.platform || dftPlatform };
}

async function main() {
  const client = await dbManager.getClient();
  const metaH = await tokenMeta(client, HUILAO, 'HUILAO', 'fourmeme');
  const metaC = await tokenMeta(client, CANGYING, 'CANGYING', 'flap');
  const bp = mkBpSvc();

  console.log('== ① HUILAO 三锚（BP50） ==');
  for (const hhmmss of ['07:15:45', '07:15:55', '07:16:21']) {
    const ms = await sigAt(client, BT2, HUILAO, hhmmss);
    const r = await bp.gateBuyPoint(HUILAO, metaH, { experimentId: 'bp50-parity' }, { anchorMs: ms });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    console.log(`${hhmmss} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${(d.market_pattern || {}).bucket}(${(d.market_pattern || {}).prob != null ? Number(d.market_pattern.prob).toFixed(2) : '?'})` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'}` +
      ` reset=${(an.marketReset ?? (r.digest && r.digest.marketReset)) ?? '?'} v=${r.questionVersion ?? '?'}`);
  }

  console.log('== ② 苍蝇两锚（BP50 判读稳定+无超限） ==');
  for (const hhmmss of ['05:10:06', '05:10:09']) {
    const ms = await sigAt(client, CY, CANGYING, hhmmss);
    const r = await bp.gateBuyPoint(CANGYING, metaC, { experimentId: 'bp50-parity' }, { anchorMs: ms });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    console.log(`${hhmmss} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${(d.market_pattern || {}).bucket}(${(d.market_pattern || {}).prob != null ? Number(d.market_pattern.prob).toFixed(2) : '?'})` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
  }

  console.log('== ③ HUILAO 07:15:55 cheat 门（CD386 接线） ==');
  const ms55 = await sigAt(client, BT2, HUILAO, '07:15:55');
  const cr = await mkCheatSvc().gateBuyPoint(HUILAO, metaH, { experimentId: 'bp50-parity' },
    { anchorMs: ms55, forceRecheck: true });
  const dg = (cr && cr.digest) || {};
  console.log(`grade=${cr.grade} exempt=${JSON.stringify((cr.info && cr.info.exempt) || null)}` +
    ` marketReset=${dg.marketReset} minVs=${dg.minVsLaunchPct ?? (dg.anchors && dg.anchors.minVsLaunchPct) ?? '?'}` +
    ` anchorTicks=${dg.fullAnchorTickCount ?? dg.anchorTickCount ?? '?'} v=${cr.questionsVersion ?? '?'}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
