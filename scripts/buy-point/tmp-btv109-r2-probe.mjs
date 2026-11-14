// btv109 第一批复审 9 条反馈取证（182 跑）：信号轨迹/act 判档、block 级买卖分界、KOL/roster 行为、大户在场、捆绑砸盘
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const KOL = '0x609f2c912175f8cd4438c1882f291fa6a4b4c735';

const TARGETS = {
  'T018 BNC':    '0x910acf02e1bf16f6cb1ec267bfae490c87937777',
  'T003 FUNNY':  '0xadab69cfbb9f3812651432d3e22329053f867777',
  'T004 meme':   '0x2db8598edd6c865aed690af950f2f015038f7777',
  'T005 meme':   '0xc54a3e283dd5d9d7f7e0f7eaab9b0d8beb007777',
  'T006 memes':  '0xf1fc8f441e224923f44fd45f3f5bc034ba887777',
  'T012 兄弟们': '0xdedc5e872c1d25d6daed1cfc29a0cac5fd807777',
  'T015 ㅤ':     '0xe9749404b883aa047e4bb01de5c7edeb56047777',
  'T016 萨摩耶': '0x93d56791dedc296ed1b07b1b1d8392e771e88888',
  'T017 豆介':   '0x5cd9995c98b3958c207dbdc2c5829c3db9007777',
};
const NEED_BLOCKS = new Set(['T003 FUNNY', 'T004 meme', 'T006 memes', 'T012 兄弟们', 'T016 萨摩耶']);
const NEED_TRACE = new Set(['T018 BNC', 'T015 ㅤ']);
const NEED_WHALES = new Set(['T016 萨摩耶', 'T017 豆介']);

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const anchorOf = new Map(set.points.map(p => [p.tokenAddress, p.anchorTimeIso]));

// ── 信号轨迹（全部 BUY，含被拒）──
const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const byTok = new Map();
for (const s of sigs) {
  if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
  byTok.get(s.token_address).push(s);
}

// ── famous roster ──
let roster = [];
try { roster = JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets || []; } catch { try { roster = JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')); } catch {} }
const rosterSet = new Set((Array.isArray(roster) ? roster : []).map(w => String(w.address || w).toLowerCase()));

const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const ts = (iso) => Date.parse(iso) / 1000;

for (const [name, addr] of Object.entries(TARGETS)) {
  const j = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8'));
  const rows = j.rows;
  const anchor = anchorOf.get(addr) || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  console.log(`\n════ ${name} ${addr} ════`);
  console.log(`ticks=${rows.length} 窗 ${rows[0].block_time.slice(11, 19)}→${rows[rows.length - 1].block_time.slice(11, 19)} 锚=${anchor.slice(11, 19)}`);

  // A. 信号轨迹
  const list = byTok.get(addr) || [];
  const buys = list.filter(s => s.action === 'buy');
  console.log(`BUY 信号 ${buys.length} 条：`);
  buys.forEach((s, i) => {
    const cc = s.metadata?.cheatCheck, bp = s.metadata?.buyPoint;
    const ccStr = cc ? `${cc.grade}${cc.exempt ? '(ex:' + cc.exempt.code + ')' : ''}${cc.levels ? ' act=' + (cc.levels.activityLevel ?? '?') : ''}${(cc.reasons || []).length ? '[' + cc.reasons.join(',') + ']' : ''}` : '无cheat段';
    const bpStr = bp ? `bp:${bp.status}${bp.rule ? '/' + bp.rule : ''}` : '';
    console.log(`  #${i + 1} ${s.created_at.slice(11, 19)} ${s.executed ? '✅成交' : '❌拒'} ${s.metadata?.strategyName || ''} ${ccStr} ${bpStr}`.trim());
  });

  // B. block 级买卖分界（锚前+锚后120s）
  if (NEED_BLOCKS.has(name)) {
    const blocks = new Map();
    for (const r of rows) {
      const t = ts(r.block_time);
      if (t > aTs + 120) continue;
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts: r.block_time.slice(11, 19), buy: 0, sell: 0, nb: 0, ns: 0, wallets: new Set() });
      const b = blocks.get(r.block_number);
      if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; } else { b.sell += r.bnb_amount; b.ns++; }
      b.wallets.add(wallet(r));
    }
    console.log(`block 结构（锚=${anchor.slice(11, 19)}，+120s 截断）${blocks.size} 块：`);
    for (const b of [...blocks.values()].sort((x, y) => x.blk - y.blk))
      console.log(`  ${b.ts} b${b.buy.toFixed(2)}(${b.nb}) s${b.sell.toFixed(2)}(${b.ns}) w${b.wallets.size}`);
  }

  // C. KOL / roster 行为（锚前）
  const kolRows = rows.filter(r => wallet(r) === KOL && ts(r.block_time) <= aTs);
  console.log(`KOL 0x609f 锚前: ${kolRows.length} 笔` + (kolRows.length ? ' → ' + kolRows.map(r => `${r.block_time.slice(11, 19)} ${r.trade_type} ${r.bnb_amount.toFixed(3)}`).join(', ') : '') + ` | 在roster=${rosterSet.has(KOL)}`);
  const rosterActs = new Map();
  for (const r of rows) {
    if (ts(r.block_time) > aTs) break;
    const w = wallet(r);
    if (!rosterSet.has(w)) continue;
    if (!rosterActs.has(w)) rosterActs.set(w, { buy: 0, sell: 0, n: 0, first: r.block_time, last: r.block_time });
    const o = rosterActs.get(w);
    if (r.trade_type === 'buy') o.buy += r.bnb_amount; else o.sell += r.bnb_amount;
    o.n++; o.last = r.block_time;
  }
  if (rosterActs.size) {
    console.log(`famous roster 锚内行为:`);
    for (const [w, o] of rosterActs) console.log(`  ${w.slice(0, 10)} ${o.first.slice(11, 19)}→${o.last.slice(11, 19)} 买${o.buy.toFixed(3)} 卖${o.sell.toFixed(3)} 净${(o.buy - o.sell).toFixed(3)} ${o.n}笔`);
  }

  // D. 大户在场（单笔≥0.19 买入钱包，锚时刻净额）
  if (NEED_WHALES.has(name)) {
    const bigBuyers = new Set(rows.filter(r => r.trade_type === 'buy' && r.bnb_amount >= 0.19 && ts(r.block_time) <= aTs).map(wallet));
    const agg = new Map();
    for (const r of rows) {
      if (ts(r.block_time) > aTs) break;
      const w = wallet(r);
      if (!agg.has(w)) agg.set(w, { buy: 0, sell: 0, last: r.block_time, maxBuy: 0 });
      const o = agg.get(w);
      if (r.trade_type === 'buy') { o.buy += r.bnb_amount; o.maxBuy = Math.max(o.maxBuy, r.bnb_amount); } else o.sell += r.bnb_amount;
      o.last = r.block_time;
    }
    console.log(`大户在场（单笔≥0.19 买过的钱包，锚时刻）：`);
    let any = false;
    for (const w of bigBuyers) {
      const o = agg.get(w); if (!o) continue; any = true;
      const net = o.buy - o.sell;
      const secSince = Math.round(aTs - ts(o.last));
      console.log(`  ${w.slice(0, 10)} 买${o.buy.toFixed(3)} 卖${o.sell.toFixed(3)} 净${net.toFixed(3)} max单笔${o.maxBuy.toFixed(2)} 末动${secSince}s前 ${net > 0.005 ? (secSince <= 120 ? '活跃在场' : '挂账在场') : '已清仓'}`);
    }
    if (!any) console.log('  （无单笔≥0.19 买入钱包）');
  }

  // E. 捆绑砸盘扫描（全窗 per block 卖家≥3 且卖额≥0.3）
  const dumpBlocks = [];
  {
    const blocks = new Map();
    for (const r of rows) {
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, { sell: 0, sellers: new Set(), buy: 0, ts: r.block_time });
      const b = blocks.get(r.block_number);
      if (r.trade_type === 'sell') { b.sell += r.bnb_amount; b.sellers.add(wallet(r)); } else b.buy += r.bnb_amount;
    }
    for (const b of blocks.values()) if (b.sellers.size >= 3 && b.sell >= 0.3) dumpBlocks.push(b);
  }
  if (dumpBlocks.length) {
    console.log(`捆绑砸盘块（卖家≥3 且卖≥0.3）${dumpBlocks.length} 个:`);
    for (const b of dumpBlocks.sort((x, y) => ts(x.ts) - ts(y.ts)))
      console.log(`  ${b.ts.slice(11, 19)} 卖${b.sell.toFixed(2)}/${b.sellers.size}户 买${b.buy.toFixed(2)} ${ts(b.ts) <= aTs ? '(锚前)' : `(+${Math.round(ts(b.ts) - aTs)}s)`}`);
  }
}
process.exit(0);
