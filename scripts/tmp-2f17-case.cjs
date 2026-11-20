#!/usr/bin/env node
// 临时查证：8ebaccce 实验 + 0x2f17…7777 卖出信号 case + 卖出时刻前后买卖双方（smart_bot/famous 名单比对）
const { dbManager } = require('../src/services/dbManager');

const EXP = '8ebaccce-62c6-4209-a2a0-40f361c49bf9';
const TOKEN = '0x2f17249e8d291ecb422fc5c0fc0eb313b7a57777';

function ts(s) { return String(s).replace('T', ' ').replace('Z', ''); }

async function main() {
  const sb = dbManager.getClient();
  const { data: exp } = await sb.from('experiments')
    .select('id,experiment_name,trading_mode,status,config').eq('id', EXP).limit(1);
  const x = exp && exp[0];
  if (!x) { console.log('experiment not found'); return; }
  const cfg = x.config || {};
  console.log(`=== 实验 ${EXP}\nname=${x.experiment_name} mode=${x.trading_mode} status=${x.status}`);
  console.log(`factorSellFilter=${JSON.stringify((cfg.fourmemeWs || {}).factorSellFilter || null)}`);

  // ── 信号全量（该 token）
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  if (e2) console.log(`signals err: ${e2.message}`);
  console.log(`\n=== 信号 ${(sigs||[]).length} 条`);
  for (const s of (sigs || [])) {
    const md = s.metadata || {};
    const fsf = md.factorSellFilter;
    const pp = md.profitPercent != null ? md.profitPercent : (md.factorResults || {}).profitPercent;
    console.log(`- [${ts(s.created_at)}] ${s.signal_type} strat=${s.strategy_name || '-'} reason=${(s.reason || '').slice(0, 80)} price=${s.price} status=${s.execution_status} pp=${pp}`);
    if (fsf) console.log(`    factorSellFilter: ${JSON.stringify(fsf)}`);
  }

  // ── 成交
  const { data: trs, error: e3 } = await sb.from('trades')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(100);
  if (e3) console.log(`trades err: ${e3.message}`);
  console.log(`\n=== 成交 ${(trs || []).length} 笔`);
  for (const t of (trs || [])) {
    console.log(`- [${ts(t.created_at)}] ${t.trade_type} price=${t.price_bnb} bnb=${t.amount_bnb} pnl=${t.profit_loss_bnb}`);
  }

  // ── 名单：smart_bot（wallets 表）+ famous roster（config json）
  const smart = new Set();
  {
    let lastId = 0;
    while (true) {
      const { data } = await sb.from('wallets')
        .select('id,address').eq('chain', 'bsc').eq('category', 'smart_bot')
        .gt('id', lastId).order('id', { ascending: true }).limit(1000);
      if (!data || data.length === 0) break;
      for (const r of data) smart.add(r.address.toLowerCase());
      lastId = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
  }
  const famous = new Set(
    (require('../config/rosters/famous-copy-wallets.json').wallets || [])
      .map(w => String(typeof w === 'string' ? w : (w.address || w.wallet || '')).toLowerCase()));
  console.log(`\n=== 名单 smart_bot=${smart.size} famous=${famous.size}`);

  // ── token 全程 ticks（分页）
  const rows = [];
  {
    let from = 0;
    while (true) {
      const { data } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
        .eq('token_address', TOKEN)
        .order('block_time', { ascending: true }).range(from, from + 999);
      if (!data || data.length === 0) break;
      rows.push(...data);
      from += 1000;
      if (data.length < 1000) break;
    }
  }
  console.log(`=== token ticks=${rows.length} 窗=[${ts(rows[0].block_time)} ~ ${ts(rows[rows.length - 1].block_time)}]`);

  const wallet = r => String(r.sender_address || r.trader_address || '').toLowerCase();
  const smartRows = rows.filter(r => smart.has(wallet(r)));
  const famRows = rows.filter(r => famous.has(wallet(r)));
  console.log(`\n=== smart_bot 命中行=${smartRows.length}`);
  for (const r of smartRows) {
    console.log(`  [${ts(r.block_time)}] blk=${r.block_number}/${r.log_index} ${r.trade_type} bnb=${r.bnb_amount} price=${r.price_bnb} w=${wallet(r)}`);
  }
  console.log(`\n=== famous 命中行=${famRows.length}`);
  for (const r of famRows) {
    console.log(`  [${ts(r.block_time)}] blk=${r.block_number}/${r.log_index} ${r.trade_type} bnb=${r.bnb_amount} price=${r.price_bnb} w=${wallet(r)}`);
  }

  // ── 卖出信号时刻前后 5 分钟逐行（看盘面）
  const sellSigs = (sigs || []).filter(s => s.signal_type === 'SELL');
  for (const s of sellSigs.slice(0, 3)) {
    const t0 = new Date(s.created_at).getTime();
    const near = rows.filter(r => {
      const t = new Date(r.block_time).getTime();
      return t >= t0 - 300000 && t <= t0 + 300000;
    });
    console.log(`\n=== 卖出 [${ts(s.created_at)}] ±5min 行数=${near.length}`);
    for (const r of near) {
      const w = wallet(r);
      const tag = smart.has(w) ? 'SMART' : (famous.has(w) ? 'FAMOUS' : '');
      console.log(`  [${ts(r.block_time)}] ${r.trade_type} bnb=${r.bnb_amount} price=${r.price_bnb} ${tag} w=${w.slice(0, 10)}`);
    }
    // 卖后价格走势（+10min 内可靠价 min/max/last）
    const fwd = rows.filter(r => {
      const t = new Date(r.block_time).getTime();
      return t > t0 && t <= t0 + 600000 && r.price_bnb > 0;
    });
    if (fwd.length) {
      const ps = fwd.map(r => r.price_bnb);
      console.log(`  卖后10min: min=${Math.min(...ps)} max=${Math.max(...ps)} last=${ps[ps.length - 1]} n=${ps.length}`);
    }
  }
  await dbManager.close && dbManager.close();
}

main().catch(e => { console.error(e); process.exit(1); });
