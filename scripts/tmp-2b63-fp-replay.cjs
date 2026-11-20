// FP23 端到端重放：真 buildBuyPointSnapshot + evaluateFactorPreBuy（182）
// 用法: node scripts/tmp-2b63-fp-replay.cjs <expId8>
const path = require('path');
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const M = require('../src/market-analysis/factor-pre-buy-check');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

async function main() {
  const expId8 = process.argv[2];
  if (!expId8) { console.error('usage: node tmp-2b63-fp-replay.cjs <expId8>'); process.exit(1); }
  const sb = dbManager.getClient();
  const { data: allExps } = await sb.from('experiments').select('id,experiment_name').order('created_at', { ascending: false }).limit(200);
  const exp = (allExps || []).find(e => e.id.startsWith(expId8));
  if (!exp) { console.error('EXP NOT FOUND'); process.exit(1); }
  const { data: trades } = await sb.from('trades').select('token_address,created_at,trade_direction,input_amount,output_amount')
    .eq('experiment_id', exp.id).order('created_at');
  const firstBuy = new Map();
  for (const t of (trades || []).filter(x => x.trade_direction === 'buy')) if (!firstBuy.has(t.token_address)) firstBuy.set(t.token_address, t);
  const sellByToken = new Map();
  for (const t of (trades || []).filter(x => x.trade_direction === 'sell')) {
    if (!sellByToken.has(t.token_address)) sellByToken.set(t.token_address, []);
    sellByToken.get(t.token_address).push(t);
  }
  console.log(`EXP ${expId8} ${exp.experiment_name} 首买 token=${firstBuy.size}，FP 版本=${M.FACTOR_PREBUY_VERSION}`);

  let nPass = 0, nReject = 0, rejectByReason = new Map(), dumpPairHits = [];
  for (const [token, bt] of firstBuy) {
    const anchorIso = bt.created_at;
    // 全量行（链上真序）→ 锚截窗
    const { data: rowsAll, error } = await sb.from('wss_price_ticks').select(TICK_COLS)
      .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(6000);
    if (error) throw error;
    const rows = (rowsAll || []).filter(r => r.block_time <= anchorIso);
    if (rows.length < 3) continue;
    // tokenMeta（runner 同款）
    const { data: evs } = await sb.from('wss_events').select('platform,payload,block_time')
      .eq('kind', 'token_create').eq('token_address', token).order('id', { ascending: true }).limit(5);
    const hit = (evs || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    const meta = {
      address: token, symbol: p.symbol || null, name: p.name || null,
      platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
    };
    let snap;
    try { snap = buildBuyPointSnapshot(rows, meta, { famousRoster: undefined }); }
    catch (e) { console.log(`  SNAP FAIL ${token.slice(0, 10)}: ${e.message}`); continue; }
    const r = M.evaluateFactorPreBuy(snap);
    if (r.pass) nPass++; else { nReject++; rejectByReason.set(r.reason, (rejectByReason.get(r.reason) || 0) + 1); }
    const d2 = snap.buyDerived.dump2Block;
    if (r.reason === 'dump_pair_low_absorption') {
      const sells = sellByToken.get(token) || [];
      const pnl = sells.reduce((a, s) => a + Number(s.output_amount || 0), 0) - (trades || []).filter(b => b.trade_direction === 'buy' && b.token_address === token).reduce((a, b) => a + Number(b.input_amount || 0), 0);
      dumpPairHits.push({ token, pnl, d2 });
      const g = r.gates.find(x => x.id === 'dump_pair');
      console.log(`  HIT ${token.slice(0, 10)} pnl=${pnl.toFixed(4)} | 门值: ${g && g.value}`);
    } else if (d2 && d2.sellers >= 8 && typeof d2.sellBnb === 'number' && d2.sellBnb >= 0.5) {
      // 近线观察：≥8 卖方+卖额达标但被其它腿挡下（供线宽复查）
      console.log(`  NEAR ${token.slice(0, 10)} pass=${r.pass} reason=${r.reason} | 卖方=${d2.sellers} 卖=${d2.sellBnb} 跌=${d2.dropPct} 距锚=${d2.secToAnchor} 龄=${snap.buyDerived.tokenAgeSec} 承接=${d2.followBuyRatio ?? (d2.followBuyBnb != null && d2.sellBnb > 0 ? (d2.followBuyBnb / d2.sellBnb).toFixed(3) : 'null')} 总额=${snap.buyDerived.totalVolumeBnb}`);
    }
  }
  console.log(`\nFP23 重放: pass=${nPass} reject=${nReject}`);
  for (const [k, v] of [...rejectByReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
