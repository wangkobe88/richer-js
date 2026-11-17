// 开盘后逐 block 结构研究——182 数据拉取+服务端特征计算（2026-11-14，用户指令
// 「除了开盘簇，开盘后数个block的情况都可以分析下」）
// 输入=/tmp/tmp-blockstudy-input.json（208 票：win/token/net/firstBuyAt/ageSecAtFire）
// 每 token 一查（wss_price_ticks 全局表按 token 升序 limit 900），出生段=首 tick 起 150s：
//   算 per-block-offset(0..6) 买入钱包数/买额/卖额 + 我方入场 block 偏移 + 组织块前后关系
// 输出=/tmp/tmp-blockstudy-out.json（紧凑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const DUST = 0.001; // 与 FA 尘门同线的下限（块结构统计不计尘埃单）
const SPAN_MS = 150 * 1000;

async function main() {
  const c = dbManager.getClient();
  const inp = require('/tmp/tmp-blockstudy-input.json');
  const byTok = new Map();
  for (const r of inp) {
    if (!byTok.has(r.token)) byTok.set(r.token, []);
    byTok.get(r.token).push(r);
  }
  const out = [];
  let done = 0;
  for (const [token, recs] of byTok) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,bnb_amount,block_number,block_time')
      .eq('token_address', token)
      .order('block_time', { ascending: true })
      .limit(900);
    if (error) { console.error('ERR', token, error.message); out.push({ token, err: error.message }); continue; }
    if (!data || data.length === 0) { out.push({ token, err: 'no-ticks' }); continue; }

    const launchTs = new Date(data[0].block_time).getTime();
    const launchBlock = data[0].block_number;
    const rows = data.filter(r => new Date(r.block_time).getTime() - launchTs <= SPAN_MS);

    // 逐 block offset 聚合（wallet=sender||trader，与 FA 钱包口径同；尘埃单不计）
    const blocks = new Map(); // offset -> {buyN,buyBnb,wallets:Set,sellN,sellBnb}
    for (const r of rows) {
      const off = r.block_number - launchBlock;
      if (off < 0 || off > 8) continue;
      const bnb = Number(r.bnb_amount) || 0;
      if (bnb < DUST) continue;
      const w = (r.sender_address || r.trader_address || '').toLowerCase();
      let b = blocks.get(off);
      if (!b) { b = { buyN: 0, buyBnb: 0, wallets: new Set(), sellN: 0, sellBnb: 0 }; blocks.set(off, b); }
      if (r.trade_type === 'buy') { b.buyN++; b.buyBnb += bnb; b.wallets.add(w); }
      else { b.sellN++; b.sellBnb += bnb; }
    }
    const offArr = [];
    for (let o = 0; o <= 8; o++) {
      const b = blocks.get(o);
      offArr.push(b ? { o, buyN: b.buyN, buyBnb: +b.buyBnb.toFixed(3), w: b.wallets.size, sellBnb: +b.sellBnb.toFixed(3) } : null);
    }

    // 我方入场 block 偏移：firstBuyAt 之前最后一个 tick 的 block
    const r0 = recs[0];
    const fbTs = new Date(r0.firstBuyAt.replace(' ', 'T').includes('T') ? r0.firstBuyAt.replace(' ', 'T') : r0.firstBuyAt).getTime();
    let entryBlock = null;
    for (const r of rows) { if (new Date(r.block_time).getTime() <= fbTs) entryBlock = r.block_number; else break; }
    const entryOff = entryBlock === null ? null : entryBlock - launchBlock;

    // 截断检测：fire 时真实年龄 vs 窗内首 tick 距 fire 时长差 >60s → 出生早于数据段
    const winAgeSec = (fbTs - launchTs) / 1000;
    const truncated = r0.ageSecAtFire != null && Math.abs(winAgeSec - r0.ageSecAtFire) > 60;

    out.push({
      token, symbol: r0.symbol, launchTs: data[0].block_time,
      launchBlock, nTicks150s: rows.length,
      truncated: !!truncated, winAgeSec: +winAgeSec.toFixed(1),
      entryOff, entrySec: +winAgeSec.toFixed(1),
      maxW0: blocks.get(0) ? blocks.get(0).wallets.size : 0,
      maxW1to3: Math.max(...[1,2,3].map(o => blocks.get(o) ? blocks.get(o).wallets.size : 0)),
      maxW1to5: Math.max(...[1,2,3,4,5].map(o => blocks.get(o) ? blocks.get(o).wallets.size : 0)),
      maxW4to6: Math.max(...[4,5,6].map(o => blocks.get(o) ? blocks.get(o).wallets.size : 0)),
      orgBlocks: [...blocks.entries()].filter(([, b]) => b.wallets.size >= 3).map(([o]) => o).sort((a,b)=>a-b),
      blocks: offArr,
    });
    done++;
    if (done % 40 === 0) console.log('progress', done, '/', byTok.size);
  }
  require('fs').writeFileSync('/tmp/tmp-blockstudy-out.json', JSON.stringify(out));
  console.log('DONE', out.length, 'tokens ->', '/tmp/tmp-blockstudy-out.json');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.stack || e); process.exit(1); });
