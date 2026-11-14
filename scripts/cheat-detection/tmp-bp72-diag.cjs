// 一次性诊断（182 跑）：BP72 对拍遗留三票锚窗新键数值——
//   idx26-LABU（臂 A 未翻 crash，act=high）+ f485/40a2（慢跌反例被吞 crash）
// 直接调 buildBuyPointSnapshot 打 recentDip5 三键/尾 10s 买卖/chg 族/近窗流量。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const TOKENS = [
  { exp: V100, key: 'idx26-LABU', addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777' },
  { exp: V94, key: 'RE-f485', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777' },
  { exp: V94, key: 'RE-40a2', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444' },
  // 对照：臂 A 达成票（尾 10s 买 0/卖可观）
  { exp: V100, key: 'CTL-idx175-海水', addr: '0x30238ffd6137cd0fa70e681d0d5585d413cbffff' },
];

async function pullTicks(client, addr) {
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,price_outlier,sender_address,trader_address,token_amount')
      .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  return rows;
}

async function main() {
  const client = await dbManager.getClient();
  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(60);
    const withBp = (sigs || []).filter((s) => s.metadata && s.metadata.buyPoint);
    const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    const anchorMs = Date.parse(anchor.created_at);
    const allRows = await pullTicks(client, t.addr);
    // service 口径：锚截窗在拉数层做，builder 吃已截窗行（tEnd=末行）
    const rows = allRows.filter((x) => Date.parse(x.block_time) <= anchorMs).slice(-3000);
    const snap = buildBuyPointSnapshot(rows, { address: t.addr, platform: 'fourmeme' }, {});
    const b = snap.buyDerived || {}, a = b.activity || {};
    const win = (w) => { const o = (b.win || {})[w] || {}; return `买${(+o.buyBnb).toFixed(2)}×${o.buyN}/卖${(+o.sellBnb).toFixed(2)}×${o.sellN}`; };
    console.log(`\n## ${t.key} 锚=${anchor.created_at.slice(11, 19)} 窗=${snap.anchor && snap.anchor.tickCount} 笔`);
    console.log(`  recentDip5: depth=${b.recentDip5Pct} 距今=${b.recentDip5SecAgo}s 未收复=${b.recentDip5UnrecoveredPct}%`);
    console.log(`  尾10s: 买 ${a.nearTail10BuyN} 笔/${a.nearTail10BuyBnb}B 卖 ${a.nearTail10SellBnb}B | 尾5s: ${a.nearTail5TickN} 笔买 ${a.nearTail5BuyN}/${a.nearTail5BuyBnb}B`);
    console.log(`  chg: 5=${b.chg5Pct} 10=${b.chg10Pct} 30=${b.chg30Pct} | 近窗30s ${win(30)} | 60s ${win(60)} | 120s ${win(120)}`);
    console.log(`  速度: maxDn5=${b.maxDn5Pct} nearMaxDn5=${b.nearMaxDn5Pct} curVsAth=${b.currentVsAthPct} curVsMinGap=${b.curVsMinGapPct}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
