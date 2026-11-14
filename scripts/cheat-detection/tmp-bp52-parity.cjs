// 一次性对拍（182 跑）：BP52 restart 豁免筹码门——HUILAO 0x28ad2c7d 深归零后三锚
// （bt-v87 c84fc413 实际信号时刻 07:15:55 NL15 / 07:16:00 NL20 / 07:16:05 NL25）。
// 预期：07:15:55（curVs 32.6）与 07:16:00（curVs 27）restart 判型+位置门 ≤40 已过、
// 原 chip=strong 拦 → BP52 豁免翻 neutral(gates_passed)+exempt=restart_chip；
// 07:16:05（curVs 40.9>40）已拉离照拒（restart 位置臂 pattern_gate——轮不到筹码门）。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const BTV87 = 'c84fc413-4928-45ca-9a55-b0791921820e';
const HUILAO = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', BTV87).eq('signal_type', 'BUY')
    .eq('token_address', HUILAO).order('created_at');
  if (error) throw new Error(error.message);
  const { data: ev } = await client.from('wss_events')
    .select('payload').eq('kind', 'token_create').eq('token_address', HUILAO);
  const p = (ev[0] && ev[0].payload) || {};
  const meta = { address: HUILAO, symbol: p.symbol || 'HUILAO', name: p.name || null, platform: p.platform || 'fourmeme' };
  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});
  console.log(`BP52 对拍：${meta.symbol} ${HUILAO} | bt-v87 信号 ${sigs.length} 条`);
  for (const s of sigs) {
    const leg = ((s.metadata || {}).signalGate || {}).legId || '-';
    const ms = Date.parse(s.created_at);
    const r = await bp.gateBuyPoint(HUILAO, meta, { experimentId: 'bp52-parity' }, { anchorMs: ms });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const mp = d.market_pattern || {}, chip = d.holder_concentration || {};
    const oldChip = ((s.metadata || {}).buyPoint || {}).assessment || {};
    console.log(`\n· ${s.created_at.slice(11, 19)} leg=${String(leg).replace('buy_', '')}` +
      ` status=${r.status} 综=${a.bucket}${a.rule ? '(' + a.rule + ')' : ''}` +
      (a.exempt ? ` exempt=${JSON.stringify(a.exempt)}` : '') +
      `\n  pattern=${mp.bucket}(${mp.prob != null ? Number(mp.prob).toFixed(2) : '?'})` +
      ` chip=${chip.bucket || '?'} curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'}` +
      `\n  [bt-v87 当时] 综=${oldChip.bucket}(${oldChip.rule})` +
      (oldChip.exempt ? ` exempt=${oldChip.exempt.code}` : ''));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
