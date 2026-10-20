#!/usr/bin/env node
/**
 * 临时脚本：乌龟 0xb2782a4a…fe7777 早盘逐笔（验证「0.15 买入 + 三个跟单过线」）
 * 输出：逐笔时间线 / 累计买量与钱包数 / 门槛首次突破点 / 跟单钱包画像与名单角色 / 我方信号与成交
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env') });
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');
const TOK = '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777';
const TARGET = '0x68c49e3ace53f23c0086471a126202cbfd939924';
const PAGE = 1000;
const db = dbManager.getClient();

async function fetchTok(loIso, hiIso) {
  const out = [];
  let bt = null, id = 0;
  for (;;) {
    let q = db.from('wss_price_ticks')
      .select('id,tx_hash,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_number,log_index,block_time,price_outlier')
      .eq('token_address', TOK).gte('block_time', loIso).lte('block_time', hiIso);
    if (bt) q = q.or(`block_time.gt.${bt},and(block_time.eq.${bt},id.gt.${id})`);
    const { data, error } = await q.order('block_time', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE || out.length > 20000) break;
    bt = data[data.length - 1].block_time; id = data[data.length - 1].id;
  }
  out.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  return out;
}

(async () => {
  const roster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'rosters', 'copy-wallet-roster.json'), 'utf8'));
  const RM = new Map(roster.wallets.map(w => [w.address, w]));
  const famous = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'rosters', 'famous-copy-wallets.json'), 'utf8')).wallets);

  const { data: ev, error: e1 } = await db.from('wss_events').select('payload,block_time').eq('kind', 'token_create').eq('token_address', TOK).limit(1);
  if (e1) throw new Error(e1.message);
  const p = ev?.[0]?.payload || {};
  const createdIso = ev?.[0]?.block_time || (p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : null);
  console.log(`[token] ${p.symbol || p.name} ${TOK}  creator=${p.creator}  创建=${createdIso} blk=${p.blockNumber} supply=${p.totalSupply}`);

  const lo = createdIso || new Date(Date.now() - 3 * 86400e3).toISOString();
  const hi = new Date(new Date(lo).getTime() + 10 * 60000).toISOString();
  const rows = await fetchTok(lo, hi);
  console.log(`[tick] 创建后 10min 行数=${rows.length}`);

  // 逐笔（前 120 秒全部；之后只汇总）
  const t0 = new Date(lo).getTime();
  let cumBuy = 0, buyers = new Set(), sellers = new Set();
  let firstGate = null;
  const GATE_VOL = 1.25, GATE_HOLDERS = 10;
  console.log('\n[逐笔 创建→+120s]（seq=链上真序；钱包=sender||trader；标注 名单/★目标）');
  let seq = 0;
  for (const r of rows) {
    const dt = (new Date(r.block_time).getTime() - t0) / 1000;
    if (dt > 120) break;
    seq++;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    const bnb = Number(r.bnb_amount) || 0;
    if (r.trade_type === 'buy') { cumBuy += bnb; buyers.add(w); }
    else sellers.add(w);
    const tag = w === TARGET ? '★目标' : (famous.has(w) ? 'FAMOUS' : RM.has(w) ? `名单${RM.get(w).role}` : '');
    console.log(`  #${String(seq).padStart(3)} +${dt.toFixed(0).padStart(3)}s blk=${r.block_number} li=${String(r.log_index).padStart(3)} ${r.trade_type.padEnd(4)} ${bnb.toFixed(4).padStart(8)}BNB tok=${Number(r.token_amount || 0).toExponential(2)} ${w} ${tag}`);
    if (!firstGate && cumBuy >= GATE_VOL && buyers.size >= GATE_HOLDERS) firstGate = { seq, dt, cumBuy, buyers: buyers.size, w, r };
  }
  const allBuys = rows.filter(r => r.trade_type === 'buy');
  const allBuyBnb = allBuys.reduce((s, r) => s + (Number(r.bnb_amount) || 0), 0);
  const allBuyers = new Set(allBuys.map(r => (r.sender_address || r.trader_address || '').toLowerCase()));
  console.log(`\n[10min 汇总] 买 ${allBuys.length} 笔 / ${allBuyBnb.toFixed(3)} BNB / ${allBuyers.size} 个买家；卖 ${rows.length - allBuys.length} 笔`);
  console.log(`[门槛首次同时满足 buyVolume>=${GATE_VOL} ∧ buyers>=${GATE_HOLDERS}] ` + (firstGate ? `seq#${firstGate.seq} +${firstGate.dt.toFixed(0)}s 累计=${firstGate.cumBuy.toFixed(3)}BNB 买家=${firstGate.buyers}（本笔 ${firstGate.w} ${Number(firstGate.r.bnb_amount).toFixed(3)}）` : '10min 内未满足'));

  // 目标买入前后的三笔（用户说的「三个跟单」）
  const targetIdx = rows.findIndex(r => r.trade_type === 'buy' && ((r.sender_address || r.trader_address || '').toLowerCase()) === TARGET);
  console.log('\n[目标首买之后的 6 笔]');
  for (const r of rows.slice(targetIdx + 1, targetIdx + 7)) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    const tag = famOrRoster(w, RM, famous);
    console.log(`  +${((new Date(r.block_time) - t0) / 1000).toFixed(0)}s blk=${r.block_number} li=${r.log_index} ${r.trade_type} ${Number(r.bnb_amount).toFixed(4)}BNB ${w} ${tag}`);
  }

  // 早盘买家画像（前 5 分钟）
  console.log('\n[早盘买家画像]（前 5 分钟，按首买序）');
  const seen = new Set();
  for (const r of rows) {
    if (r.trade_type !== 'buy') continue;
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    const prof = await db.from('wallet_offline_profiles').select('profile').eq('address', w).limit(1);
    const pr = prof.data?.[0]?.profile;
    const summary = pr ? `tok=${pr.tokenCount} buy=${pr.buyCount} sell=${pr.sellCount} avg=${(pr.avgBnb || 0).toFixed(3)} medHold=${pr.medianHoldSeconds}` : '无画像';
    console.log(`  ${w}  首买=${Number(r.bnb_amount).toFixed(3)}BNB ${famOrRoster(w, RM, famous)} ${summary}`);
  }

  // 我方信号/成交
  const sig = await db.from('strategy_signals').select('*').eq('token_address', TOK).limit(5);
  console.log(`\n[我方 strategy_signals] ${sig.error ? 'ERR ' + sig.error.message : (sig.data || []).length + ' 行'}`);
  for (const s of sig.data || []) {
    console.log(`  id=${s.id} exp=${s.experiment_id} ${s.created_at} strategy=${s.strategy_name || s.strategy_id} side=${s.side || '?'} signal_type=${s.signal_type || '?'}`);
    const md = s.metadata || {};
    const keys = Object.keys(md);
    if (keys.length) console.log('    metadata keys:', keys.slice(0, 30).join(','));
  }
  const tr = await db.from('trades').select('*').eq('token_address', TOK).limit(10);
  console.log(`[我方 trades] ${tr.error ? 'ERR ' + tr.error.message : (tr.data || []).length + ' 行'}`);
  for (const x of tr.data || []) console.log(`  ${x.created_at} ${x.trade_type} bnb=${x.bnb_amount} tokens=${x.token_amount} exp=${x.experiment_id} platform=${x.platform}`);
})().catch(e => { console.error(e); process.exit(1); });

function famOrRoster(w, RM, famous) {
  return w === TARGET ? '★目标(0x68c4)' : famous.has(w) ? 'FAMOUS' : RM.has(w) ? `名单:${RM.get(w).role}(f=${RM.get(w).followers},co=${RM.get(w).coTokens})` : '';
}
