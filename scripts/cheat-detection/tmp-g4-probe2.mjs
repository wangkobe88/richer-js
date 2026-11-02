// 组 4 侦查第二轮（182 跑）：token_create 真身 + 零买入纯卖出钱包（老鼠仓锚原料）
import { dbManager } from '../../src/services/dbManager.js';

const CD13 = '0x8a182a38668979d8c0a77f3f4d49bf297b937777';
const CD17 = '0xb3566fd337409e09bb39fd7f3b4e75b783007777';
const c = dbManager.getClient();

// 1) token_create 行（带 error + platform）
for (const [name, addr] of [['CD13', CD13], ['CD17', CD17]]) {
  const ev = await c.from('wss_events').select('*').eq('token_address', addr).limit(5);
  console.log(`== ${name} wss_events rows ==`, ev.error ? 'ERR: ' + ev.error.message : (ev.data || []).map(r => r.kind).join(','));
  const tc = (ev.data || []).find(r => r.kind === 'token_create');
  if (tc) console.log(`${name} token_create payload:`, JSON.stringify(tc.payload).slice(0, 500), 'sender=', tc.sender_address);
}

async function allTicks(addr) {
  const rows = [];
  let from = 0;
  for (;;) {
    const r = await c.from('wss_price_ticks')
      .select('id,block_number,log_index,trade_type,bnb_amount,trader_address,sender_address,tx_hash,price_bnb,block_time')
      .eq('token_address', addr).gt('id', from)
      .order('id', { ascending: true }).limit(500);
    if (r.error) throw new Error(r.error.message);
    rows.push(...r.data);
    if (r.data.length < 500) break;
    from = r.data[r.data.length - 1].id;
  }
  return rows;
}

function zeroBuySellers(ticks, label) {
  const sorted = [...ticks].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  const wm = new Map();
  for (const t of sorted) {
    const w = t.sender_address || t.trader_address;
    const o = wm.get(w) || { buy: 0, sell: 0, firstBlk: t.block_number, sells: [] };
    if (t.trade_type === 'buy') o.buy += Number(t.bnb_amount);
    else { o.sell += Number(t.bnb_amount); o.sells.push([t.block_number, Number(t.bnb_amount)]); }
    wm.set(w, o);
  }
  const totalSell = [...wm.values()].reduce((s, o) => s + o.sell, 0);
  const totalBuy = [...wm.values()].reduce((s, o) => s + o.buy, 0);
  const rats = [...wm.entries()].filter(([, o]) => o.sell > 0 && o.buy < o.sell * 0.1); // 买入不足卖出 10% = 筹码非市场所得
  const ratSell = rats.reduce((s, [, o]) => s + o.sell, 0);
  console.log(`\n== ${label} 零买入(≤10%)纯卖出钱包 ==`);
  console.log(`总买入 ${totalBuy.toFixed(2)} / 总卖出 ${totalSell.toFixed(2)} BNB；老鼠仓形钱包 ${rats.length} 个，卖出合计 ${ratSell.toFixed(3)} BNB = 总卖出的 ${(ratSell / totalSell * 100).toFixed(1)}%`);
  for (const [w, o] of rats.sort((a, b) => b[1].sell - a[1].sell).slice(0, 15)) {
    console.log(w, 'buy=' + o.buy.toFixed(4), 'sell=' + o.sell.toFixed(4), '卖出点=' + o.sells.map(([b, a]) => `blk${b}(${a.toFixed(3)})`).join(' '));
  }
  // 首窗买入集中度（抢跑者首买原料）：前 10 笔买入
  const buys = sorted.filter(t => t.trade_type === 'buy');
  console.log(`首笔买入 top: ` + buys.slice(0, 5).map(t => `${Number(t.bnb_amount).toFixed(2)}(w=${(t.sender_address || t.trader_address).slice(0, 8)})`).join(' '));
  return wm;
}

const t13 = await allTicks(CD13);
const wm13 = zeroBuySellers(t13, 'CD13 全量(137)');
// CD13 锚窗（46）内切片
{
  const sorted = [...t13].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index).slice(0, 46);
  zeroBuySellers(sorted, 'CD13 锚窗(46)');
}
const t17 = await allTicks(CD17);
zeroBuySellers(t17, 'CD17 全量(423)');
{
  const sorted = [...t17].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index).slice(0, 31);
  zeroBuySellers(sorted, 'CD17 锚窗(31)');
}
process.exit(0);
