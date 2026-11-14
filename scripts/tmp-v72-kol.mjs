/** v72 KOL 钱包参与扫描（182 跑，一次性不进 git）：
 * 1) 94 票全扫 0x3472ccf6… 是否参与（wallet=sender||trader）+ 首次参与时刻相对锚位置
 * 2) CD300 驴来逐行时间线 + 盘内占比
 * 输入 /tmp/v72-kol-tokens.json → 输出 /tmp/v72-kol.json */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const sb = () => require_('../src/services/dbManager').dbManager.getClient();

const WALLET = '0x3472ccf6209925204b9cf352171ee150904fda7e';
const FOCUS = '0xa856c666595f556f647f94d741aae389baf97777'; // CD300 驴来
const TOKENS = JSON.parse(readFileSync('/tmp/v72-kol-tokens.json', 'utf8'));
const COLS = 'id,block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address';

async function pullAll(token) {
  const rows = [];
  let anchorId = 0;
  for (let page = 0; page < 40; page++) {
    const { data, error } = await sb().from('wss_price_ticks')
      .select(COLS).eq('token_address', token)
      .gt('id', anchorId)
      .order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(`ticks 查询失败(${token}): ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    anchorId = data[data.length - 1].id;
  }
  // 链上真序
  rows.sort((a, b) => Number(a.block_number) - Number(b.block_number) || Number(a.log_index) - Number(b.log_index));
  return rows;
}

const out = [];
let i = 0;
for (const t of TOKENS) {
  i++;
  const rows = await pullAll(t.addr);
  const w = rows.filter((r) =>
    (r.sender_address || '').toLowerCase() === WALLET || (r.trader_address || '').toLowerCase() === WALLET);
  const rec = { caseId: t.caseId, symbol: t.symbol, addr: t.addr, anchor: t.anchor, total: rows.length, walletRows: w.length };
  if (w.length) {
    let buyBnb = 0, sellBnb = 0, netToken = 0;
    for (const r of w) {
      const bnb = Number(r.bnb_amount || 0);
      const tok = Number(r.token_amount || 0);
      if (r.trade_type === 'buy') { buyBnb += bnb; netToken += tok; }
      else { sellBnb += bnb; netToken -= tok; }
    }
    rec.firstAt = w[0].block_time;
    rec.lastAt = w[w.length - 1].block_time;
    rec.firstIdx = rows.indexOf(w[0]) + 1;              // 链上真序 1-based
    rec.firstVsAnchor = rec.firstIdx - t.anchor;         // 负=锚前已参与
    rec.buyCount = w.filter((r) => r.trade_type === 'buy').length;
    rec.sellCount = w.filter((r) => r.trade_type === 'sell').length;
    rec.buyBnb = +buyBnb.toFixed(4); rec.sellBnb = +sellBnb.toFixed(4);
    rec.netToken = +netToken.toFixed(0);
  }
  if (t.addr === FOCUS) {
    // 盘内占比 + 逐行时间线
    const totBuy = rows.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + Number(r.bnb_amount || 0), 0);
    const wBuy = w.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + Number(r.bnb_amount || 0), 0);
    rec.poolBuyPct = totBuy > 0 ? +(wBuy / totBuy * 100).toFixed(1) : null;
    rec.timeline = w.map((r) => ({
      t: r.block_time, i: rows.indexOf(r) + 1, type: r.trade_type,
      bnb: +Number(r.bnb_amount || 0).toFixed(4), token: +Number(r.token_amount || 0).toFixed(0),
      price: r.price_bnb ? +Number(r.price_bnb).toPrecision(3) : null,
    }));
  }
  out.push(rec);
  if (i % 10 === 0) console.log(`… ${i}/${TOKENS.length}`);
}
writeFileSync('/tmp/v72-kol.json', JSON.stringify(out, null, 1));
const hits = out.filter((r) => r.walletRows > 0);
console.log(`完成：参与 ${hits.length}/94 票`);
for (const h of hits) console.log(`  ${h.caseId} ${h.symbol} rows=${h.walletRows} 首=${h.firstAt} idx=${h.firstIdx}(锚${h.anchor}${h.firstVsAnchor >= 0 ? '+' : ''}${h.firstVsAnchor}) 买${h.buyCount}/${h.buyBnb} 卖${h.sellCount}/${h.sellBnb} 净${h.netToken}`);
