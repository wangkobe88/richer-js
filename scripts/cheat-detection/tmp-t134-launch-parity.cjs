// 一次性（182 跑）：T134 滚动地板对拍 v2——族一 9 票 bt-v100 信号锚新旧 launch/curVs 对照。
// v1 教训：snapshot 内部按 (block_number, log_index) 链上真序排序，同秒多笔 id 序≠链上序
// （idx192 首秒两笔 4.4905/4.1271）——复算旧口径必须先按链上真序排。
// 旧口径（T130）=min(常量, 窗内首笔 BUY 可靠价)（launchCovered=false 时=常量）；
// 新口径（T134）=min(常量, 窗内最低可靠价)（launchCovered 门退役）。
// 生产真相=bt-v100 信号 metadata.buyPoint.anchors（旧判定实值）——与复算旧值互证；
// 末点对照=锚在末 tick（深跌后反弹形状的锚追踪演示——立法语义「低价幻觉显性化」）。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');
const { resolveLaunchPriceBnb } = require('../../src/market-analysis/launch-price');

const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const TOKENS = [
  ['idx2 정책콕', '0x9d147fa0e447d98cf1a7ac32f114f6d0b9877777', 'flap'],
  ['idx95 咪咪', '0x3d11be20f94428d34fd21c9fae24aa6cfc5cffff', 'fourmeme'],
  ['idx164 TukTuk', '0x2711e159f3e9ff438ff2bb80456d19a6bd827777', 'flap'],
  ['idx165 MBF', '0xa29fefb9922a761093a316e9f658c0f0ebc07777', 'flap'],
  ['idx167 memectuk', '0x9dfe83281eb66b74dd5c432395a3b14091967777', 'flap'],
  ['idx182 CR', '0x4a9a469973b8bc8486a923490ecdc3cf249a7777', 'flap'],
  ['idx192 팔꿈치', '0x1ff6da9856abf6d7869797f46468f5e883c57777', 'flap'],
  ['idx143 我靠', '0xcbfe6b2bceacfab7934c82513f568f4e31a04444', 'fourmeme'],
  ['idx180 SAMSUNG', '0x54117eb6d2481dc8d89ee377e00e683f882f7777', 'flap'],
];

function compareAt(win, meta, constLaunch, createdAt, label, prodCurVs) {
  const snap = buildBuyPointSnapshot(win, meta, { anchorTickCount: win.length, signalInfo: null });
  const bd = snap.buyDerived || {};
  // 旧口径（T130）复算：链上真序窗内首笔 BUY 可靠价（launchCovered=false → 常量）
  const covered = createdAt != null && win.length
    && (Date.parse(win[0].block_time) - Date.parse(createdAt)) <= 90000;
  let firstBuy = null;
  for (const r of win) {
    if (r.trade_type === 'buy' && !r.price_outlier && r.price_bnb > 0) { firstBuy = r.price_bnb; break; }
  }
  const launchOld = covered && firstBuy ? Math.min(constLaunch, firstBuy) : constLaunch;
  let lastRel = null;
  for (const r of win) { if (!r.price_outlier && r.price_bnb > 0) lastRel = r.price_bnb; }
  const curVsOld = launchOld && lastRel ? ((lastRel / launchOld) - 1) * 100 : null;
  const fmt = (v) => v == null ? '-' : Number(v).toFixed(1);
  const gate = (v) => v == null ? '?' : (v <= 28.5 ? '过' : '拒');
  const prod = prodCurVs != null ? ` 生产旧curVs=${fmt(prodCurVs)}` : '';
  console.log(`  ${label} |${prod} 复算旧 launch=${launchOld.toExponential(4)} curVs=${fmt(curVsOld)} 门${gate(curVsOld)}`
    + ` || T134新 launch=${bd.launchPriceBnb != null ? bd.launchPriceBnb.toExponential(4) : '-'} curVs=${fmt(bd.currentVsLaunchPct)} minVs=${fmt(bd.minVsLaunchPct)} 门${gate(bd.currentVsLaunchPct)}`);
}

async function main() {
  const client = await dbManager.getClient();
  for (const [name, addr, platform] of TOKENS) {
    const { data: creates } = await client.from('wss_events').select('block_time,payload')
      .eq('kind', 'token_create').eq('token_address', addr).limit(1);
    const createdAt = creates && creates[0] ? creates[0].block_time : null;
    const p = (creates && creates[0] && creates[0].payload) || {};
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .eq('token_address', addr).order('created_at', { ascending: true }).limit(30);
    // 无信号票兜底：trades 首笔买成交时刻
    let tradeAnchor = null;
    if (!sigs || !sigs.length) {
      const { data: trs } = await client.from('trades')
        .select('created_at,executed_at').eq('experiment_id', EXP).eq('token_address', addr)
        .eq('side', 'buy').order('created_at', { ascending: true }).limit(1);
      if (trs && trs.length) tradeAnchor = trs[0].executed_at || trs[0].created_at;
    }
    const anchors = [];
    for (const s of (sigs || [])) anchors.push([`信号 ${s.created_at.slice(11, 19)}`, Date.parse(s.created_at), (s.metadata && s.metadata.buyPoint && s.metadata.buyPoint.anchors || {}).currentVsLaunchPct]);
    if (tradeAnchor) anchors.push([`成交 ${String(tradeAnchor).slice(11, 19)}`, Date.parse(tradeAnchor), null]);
    if (!anchors.length) { console.log(`\n== ${name} [${platform}] == 无信号无成交`); continue; }
    const rows = [];
    let fromId = 0;
    for (;;) {
      const { data, error } = await client.from('wss_price_ticks')
        .select('id,block_time,block_number,log_index,price_bnb,trade_type,price_outlier')
        .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
    // 链上真序（snapshot 同款；id 序≠链上序——同秒多笔 log_index 决先后）
    rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
    const constLaunch = resolveLaunchPriceBnb(platform, null);
    const meta = { address: addr, symbol: p.symbol, name: p.name, platform, createdAt };
    console.log(`\n== ${name} [${platform}] ticks=${rows.length} 常量=${constLaunch.toExponential(4)} ==`);
    for (const [label, anchorMs, prodCurVs] of anchors) {
      const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs).slice(-3000);
      if (!win.length) { console.log(`  ${label} 锚窗空`); continue; }
      compareAt(win, meta, constLaunch, createdAt, label, prodCurVs);
    }
    // 末点对照（深跌后反弹的锚追踪演示）
    const lastMs = Date.parse(rows[rows.length - 1].block_time);
    compareAt(rows, meta, constLaunch, createdAt, '末点(全窗)', null);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
