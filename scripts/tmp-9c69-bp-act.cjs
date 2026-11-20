#!/usr/bin/env node
// 临时查证：9b31baf4 实验 0x9c69…7777 买入点位 activity_level 判高——是否只是瞬时流量
const { dbManager } = require('../src/services/dbManager');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x9c694337c5a4c4156b3529a86375e4577edb7777';

function pct(n, d) { return n == null ? 'null' : (n / 1e18).toFixed(d == null ? 6 : d); }

async function main() {
  const sb = dbManager.getClient();

  // 1) BUY 信号
  const { data: sigs, error: e1 } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(50);
  if (e1) throw new Error(e1.message);
  console.log(`signals=${sigs.length}`);
  if (sigs.length) console.log(`sig cols: ${Object.keys(sigs[0]).join(',')}`);
  for (const s of sigs) {
    const md = s.metadata || {};
    const bp = md.buyPoint;
    const act = bp && (bp.activity || bp.activityLevel);
    console.log(`\n[${s.created_at}] type=${s.signal_type} status=${s.status} strategy=${s.strategy_id} price=${s.price}`);
    if (bp) {
      console.log(`  assessment: ${JSON.stringify(bp.assessment).slice(0, 6000)}`);
      if (bp.dimensions) console.log(`  dimensions: ${JSON.stringify(bp.dimensions).slice(0, 4000)}`);
    }
    if (md.cheatCheck) {
      const cc = md.cheatCheck;
      console.log(`  cheat: grade=${cc.grade} act=${cc.activity || cc.activityLevel} levels=${JSON.stringify(cc.levels || {}).slice(0, 600)}`);
    }
    if (md.actFrontGate) console.log(`  actFront: ${JSON.stringify(md.actFrontGate).slice(0, 800)}`);
    if (md.signalGate) console.log(`  signalGate: ${JSON.stringify({ ...md.signalGate, factorResults: undefined }).slice(0, 600)}`);
  }

  // 2) 锚点附近 ticks 时间线（单 token 小窗）
  const anchorStr = sigs.find((s) => s.signal_type === 'BUY');
  const anchor = anchorStr ? new Date(anchorStr.created_at) : new Date();
  const from = new Date(anchor.getTime() - 16 * 60 * 1000).toISOString();
  const to = new Date(anchor.getTime() + 20 * 1000).toISOString();
  const { data: ticks, error: e2 } = await sb.from('wss_price_ticks')
    .select('*')
    .eq('token_address', TOKEN)
    .gte('block_time', from).lte('block_time', to)
    .order('block_time', { ascending: true }).limit(500);
  if (e2) throw new Error(e2.message);
  console.log(`\n=== ticks ${from} .. ${to} rows=${ticks.length} (anchor=${anchor.toISOString()})`);
  if (ticks.length) console.log(`tick cols: ${Object.keys(ticks[0]).join(',')}`);
  let prev = null;
  for (const t of ticks) {
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    const gap = prev ? ((new Date(t.block_time) - prev) / 1000).toFixed(1) : '-';
    const bnb = t.bnb_amount != null ? (t.bnb_amount / 1e18).toFixed(4) : (t.bnb_amt != null ? (t.bnb_amt / 1e18).toFixed(4) : '?');
    const side = t.trade_type != null ? t.trade_type : (t.is_buy ? 'BUY' : 'SELL');
    console.log(`${t.block_time} blk=${t.block_number}.${t.log_index} ${side} bnb=${bnb} px=${t.price_bnb || t.price || t.rel_price} gap=${gap}s w=${w.slice(0, 10)} out=${t.price_outlier}`);
    prev = new Date(t.block_time);
  }

  // 3) 实验名 + 成交盈亏
  const { data: ex, error: e3 } = await sb.from('experiments').select('experiment_name,trading_mode,status').eq('id', EXP).limit(1);
  if (!e3 && ex && ex[0]) console.log(`\nexp: ${ex[0].experiment_name} mode=${ex[0].trading_mode} status=${ex[0].status}`);
  const { data: tr, error: e4 } = await sb.from('trades')
    .select('trade_type,amount,price,profit_loss,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(20);
  if (!e4 && tr) {
    for (const t of tr) console.log(`trade [${t.created_at}] ${t.trade_type} amt=${t.amount} px=${t.price} pnl=${t.profit_loss}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
// 附:SELL 信号 metadata + trades 全列
