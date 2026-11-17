// famous 钱包在系统首买前的 near_launch 区间（curVs∈(+10,+40]，T133 口径）买入效果
// 分类分析（182 跑）：两实验成交票 × famous near_launch 买入额分桶 × 净额/胜率
const { dbManager } = require('../src/services/dbManager.js');
const FAMOUS = require('../config/rosters/famous-copy-wallets.json');
const ROSTER = new Set((FAMOUS.wallets || []).map((w) => w.toLowerCase()));
const LAUNCH_CONST = 4496173469e-18; // fourmeme 主流档常量（near_launch 判定锚）

async function expId(c, pre) { const { data } = await c.from('experiments').select('id').limit(500); return data.find((e) => e.id.startsWith(pre)).id; }

async function trades(c, id) {
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
      .eq('experiment_id', id).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
  }
  return rows.filter((t) => t.success !== false);
}

async function main() {
  const c = await dbManager.getClient();
  for (const [tag, pre] of [['bt-v133（T144 对拍窗）', '550f9e89'], ['bt-v121（A 窗扩展门）', '54dac9c5']]) {
    const id = await expId(c, pre);
    const trs = await trades(c, id);
    // per-token：系统首买时刻 + 净额
    const tok = new Map();
    for (const t of trs) {
      const buy = t.trade_direction === 'buy';
      const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
        : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
      let e = tok.get(t.token_address);
      if (!e) { e = { sym: t.token_symbol, firstBuyAt: null, buyBnb: 0, sellBnb: 0 }; tok.set(t.token_address, e); }
      if (buy) { e.buyBnb += v; if (!e.firstBuyAt || t.created_at < e.firstBuyAt) e.firstBuyAt = t.created_at; }
      else e.sellBnb += v;
    }
    for (const [, e] of tok) e.net = e.sellBnb - e.buyBnb;
    // per-token：famous 首买前 near_launch 买入额
    const buckets = [
      ['0（无 famous near_launch 买入）', (v) => v === 0],
      ['(0, 0.2)（零星/尘埃）', (v) => v > 0 && v < 0.2],
      ['[0.2, 0.5)（常见交易档，未达像样线）', (v) => v >= 0.2 && v < 0.5],
      ['≥0.5（像样 famous 进场，T136 线）', (v) => v >= 0.5],
    ];
    const res = buckets.map(([label]) => ({ label, toks: [] }));
    let n = 0;
    for (const [addr, e] of tok) {
      n++;
      const { data: ticks } = await c.from('wss_price_ticks')
        .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
        .eq('token_address', addr)
        .lte('block_time', e.firstBuyAt)
        .order('block_time', { ascending: true }).range(0, 1999);
      let famNl = 0; // famous near_launch 区间买入 BNB 合计
      let famAll = 0; // famous 全区间买入（对照）
      for (const t of ticks || []) {
        if (t.trade_type !== 'buy') continue;
        const w = (t.sender_address || t.trader_address || '').toLowerCase();
        if (!ROSTER.has(w)) continue;
        famAll += Number(t.bnb_amount || 0);
        const p = Number(t.price_bnb || 0);
        if (p > 0) {
          const vs = (p / LAUNCH_CONST - 1) * 100;
          if (vs > 10 && vs <= 40) famNl += Number(t.bnb_amount || 0);
        }
      }
      e.famNl = +famNl.toFixed(4); e.famAll = +famAll.toFixed(4);
      for (let i = 0; i < buckets.length; i++) if (buckets[i][1](e.famNl)) { res[i].toks.push({ addr, e }); break; }
    }
    console.log(`\n########## ${tag}（${tok.size} 票成交）##########`);
    for (const b of res) {
      const net = b.toks.reduce((s, x) => s + x.e.net, 0);
      const win = b.toks.filter((x) => x.e.net > 0).length;
      console.log(`\n== ${b.label}：${b.toks.length} 票  净额${net >= 0 ? '+' : ''}${net.toFixed(4)}  胜率 ${b.toks.length ? Math.round(win / b.toks.length * 100) : 0}%（${win}/${b.toks.length}）==`);
      for (const { addr, e } of b.toks.sort((a, b2) => b2.e.net - a.e.net).slice(0, 8))
        console.log(`   ${e.net >= 0 ? '+' : ''}${e.net.toFixed(4)}  famNL=${e.famNl}  fam全=${e.famAll}  ${(e.sym || '?').slice(0, 12)} ${addr}`);
    }
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
