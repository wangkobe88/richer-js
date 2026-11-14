// 一次性探针（182 跑）：慢跌 vs 砸盘区分轴——五用户票（f485/40a2/a813/c84a/28ad）+ 两对照（LOVE/STOCKLESS）
// 锚前 90s ticks 5s 桶分解（价格变% + 买卖笔/额）+ ATH 距锚秒数 + 近 30s 承接结构。
const { dbManager } = require('../../src/services/dbManager.js');

const CASES = [
  { exp: '85cbad14-696f-49b2-baa4-a5407df4a2d2', tag: 'f485-用户放', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777' },
  { exp: '85cbad14-696f-49b2-baa4-a5407df4a2d2', tag: '40a2-用户放', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444' },
  { exp: '85cbad14-696f-49b2-baa4-a5407df4a2d2', tag: 'a813-用户放', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777' },
  { exp: '675c71a1-0e19-49b6-924b-facffc073afd', tag: 'c84a-用户放', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777' },
  { exp: '675c71a1-0e19-49b6-924b-facffc073afd', tag: '28ad-用户放', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444' },
  { exp: '675c71a1-0e19-49b6-924b-facffc073afd', tag: 'LOVE-对照拦?', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777' },
  { exp: '675c71a1-0e19-49b6-924b-facffc073afd', tag: 'STOCKLESS-对照拦?', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777' },
];

async function main() {
  const client = await dbManager.getClient();
  for (const c of CASES) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at,metadata')
      .eq('experiment_id', c.exp).eq('token_address', c.addr)
      .order('id', { ascending: true }).limit(30);
    const bp = (sigs || []).find((s) => s.metadata && s.metadata.buyPoint);
    if (!bp) { console.log(`\n## ${c.tag}: 无 BP 行`); continue; }
    const anchorMs = Date.parse(bp.created_at);
    const { data: rows } = await client.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,sender_address,trader_address')
      .eq('token_address', c.addr).lte('block_time', bp.created_at)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
    const all = rows || [];
    const rel = all.filter((r) => anchorMs - Date.parse(r.block_time) <= 90000 && !r.price_outlier && Number(r.price_bnb || 0) > 0);
    if (!rel.length) { console.log(`\n## ${c.tag}: 锚前 90s 无可靠价行`); continue; }
    // ATH（锚前 90s 可靠价最高）时刻
    let ath = null;
    for (const r of rel) if (!ath || Number(r.price_bnb) > Number(ath.price_bnb)) ath = r;
    const athAgo = (anchorMs - Date.parse(ath.block_time)) / 1000;
    const cur = rel[rel.length - 1];
    const curVsAth = (Number(cur.price_bnb) / Number(ath.price_bnb) - 1) * 100;
    console.log(`\n## ${c.tag} 锚=${bp.created_at.slice(11, 19)} 90s行=${rel.length} ATH距锚=${athAgo.toFixed(0)}s curVsAth=${curVsAth.toFixed(1)}%`);
    // 5s 桶分解（t-90 → t-0）
    const buckets = [];
    for (let i = 17; i >= 0; i--) {
      const hi = anchorMs - i * 5000, lo = hi - 5000;
      const b = rel.filter((r) => { const t = Date.parse(r.block_time); return t > lo && t <= hi; });
      if (!b.length) { buckets.push(null); continue; }
      const first = Number(b[0].price_bnb), last = Number(b[b.length - 1].price_bnb);
      const buys = b.filter((r) => r.trade_type === 'buy');
      const sells = b.filter((r) => r.trade_type === 'sell');
      buckets.push({
        chg: (last / first - 1) * 100,
        n: b.length, bn: buys.length, sn: sells.length,
        bb: buys.reduce((a, r) => a + Number(r.bnb_amount || 0), 0),
        sb: sells.reduce((a, r) => a + Number(r.bnb_amount || 0), 0),
      });
    }
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b) { console.log(`  t-${(18 - i) * 5}s  (空)`); continue; }
      console.log(`  t-${(18 - i) * 5}s  价${b.chg >= 0 ? '+' : ''}${b.chg.toFixed(1)}%  行${b.n}(买${b.bn}/${b.bb.toFixed(2)} 卖${b.sn}/${b.sb.toFixed(2)})`);
    }
    // 近 30s 承接结构
    const last30 = rel.filter((r) => anchorMs - Date.parse(r.block_time) <= 30000);
    const b30 = last30.filter((r) => r.trade_type === 'buy'), s30 = last30.filter((r) => r.trade_type === 'sell');
    const bw = new Set(b30.map((r) => (r.sender_address || r.trader_address || '').toLowerCase()));
    const sw = new Set(s30.map((r) => (r.sender_address || r.trader_address || '').toLowerCase()));
    console.log(`  近30s: 行${last30.length} 买${b30.length}/${b30.reduce((a, r) => a + Number(r.bnb_amount || 0), 0).toFixed(2)}BNB/${bw.size}钱包 卖${s30.length}/${s30.reduce((a, r) => a + Number(r.bnb_amount || 0), 0).toFixed(2)}BNB/${sw.size}钱包`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
