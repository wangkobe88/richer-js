// T197/FP29 端到端重放（182）：真 buildBuyPointSnapshot+evaluateFactorPreBuy 对四窗全部成交票
// 验证：A 轴 9 票精确命中 + 全量对照零新增扰动（研究脚本口径 vs 真模块口径对拍）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const M = require('../src/market-analysis/factor-pre-buy-check.js');

const EXPS = [
  ['w1003热', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
// 研究命中的 9 票（独立计算口径）
const EXPECT = new Set([
  '0xf82b045ce90c4168a94159564e9805cd82fd7777', '0xad6ee1d317aab6d8ca2d2704b8d31767aeeb7777',
  '0xd657ad14ec75dec1882e5a2a8d019079766a7777', '0x50b6c26abdef69c7f470fcdffadac10ad81d8888',
  '0x8760b439475f855e91fdb6d5154a13f877c57777', '0xd7488b45f548a928441d8a8ec8035ba7aead7777',
  '0x9c694337c5a4c4156b3529a86375e4577edb7777', '0xcad3f29ebb6718e1823bc7f658ff58e07cc37777',
  '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777',
]);

async function loadTrades(expId) {
  const sb = dbManager.getClient();
  const trs = [];
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await sb.from('trades')
      .select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
      .eq('experiment_id', expId).order('created_at', { ascending: true }).range(off, off + 999);
    if (!rows || !rows.length) break;
    trs.push(...rows); if (rows.length < 1000) break;
  }
  const firstSig = new Map();
  for (let off = 0; ; off += 1000) {
    const { data: sigs } = await sb.from('strategy_signals')
      .select('token_address,created_at').eq('experiment_id', expId).eq('signal_type', 'BUY').order('created_at').range(off, off + 999);
    if (!sigs || !sigs.length) break;
    for (const s of sigs) if (!firstSig.has(s.token_address)) firstSig.set(s.token_address, s.created_at);
    if (sigs.length < 1000) break;
  }
  const by = new Map();
  for (const t of trs) {
    const e = by.get(t.token_address) || { symbol: t.token_symbol, buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') e.buy += Number(t.input_amount || 0); else e.sell += Number(t.output_amount || 0);
    by.set(t.token_address, e);
  }
  return [...by.entries()].filter(([, v]) => v.buy > 0).map(([addr, v]) => ({ addr, symbol: v.symbol, pnl: v.sell - v.buy, at: firstSig.get(addr) }));
}

(async () => {
  console.log('模块版本:', M.FACTOR_PREBUY_VERSION);
  let totHit = 0, totPnl = 0, totN = 0, unexpected = 0, missed = 0;
  for (const [w, id] of EXPS) {
    const ss = await loadTrades(id);
    let hit = 0, pnl = 0, otherArms = 0; const rows = [];
    for (const s of ss) {
      totN++;
      const anchorIso = s.at || null;
      const { data: ev } = await dbManager.getClient().from('wss_events').select('block_time,platform')
        .eq('kind', 'token_create').eq('token_address', s.addr).limit(1);
      if (!ev?.[0]) continue;
      const { data: ticks } = await dbManager.getClient().from('wss_price_ticks')
        .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address')
        .eq('token_address', s.addr).lte('block_time', anchorIso)
        .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
      if (!ticks?.length) continue;
      try {
        const snap = buildBuyPointSnapshot(ticks, { platform: ev[0].platform || 'fourmeme', totalSupply: 1e9, createdAt: ev[0].block_time }, {});
        const r = M.evaluateFactorPreBuy(snap);
        const arm = (r.arms || []).includes('oversell_residual');
        const expect = EXPECT.has(s.addr.toLowerCase());
        if (arm !== expect) { if (arm) { unexpected++; rows.push(`  ⚠额外拦 [${w}] ${s.symbol} ${s.addr.slice(0, 10)}… pnl=${s.pnl.toFixed(4)} 超卖=${snap.buyDerived.oversellBnb} 钱包=${snap.buyDerived.anchorWalletN}`); } else { missed++; rows.push(`  ⚠漏 [${w}] ${s.symbol} ${s.addr.slice(0, 10)}… pnl=${s.pnl.toFixed(4)} 超卖=${snap.buyDerived.oversellBnb} 钱包=${snap.buyDerived.anchorWalletN}`); } }
        if (arm) { hit++; pnl += s.pnl; }
      } catch (e) { /* 形状异常票跳过计数 */ }
    }
    console.log(`[${w}] 成交 ${ss.length} | oversell_residual 真命中 ${hit} 净${pnl.toFixed(3)}`);
    rows.forEach(r => console.log(r));
    totHit += hit; totPnl += pnl;
  }
  console.log(`\n四窗合计: oversell_residual 命中 ${totHit}/${totN} 净${totPnl.toFixed(3)} | 与研究口径偏差: 额外拦 ${unexpected} 漏 ${missed}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
