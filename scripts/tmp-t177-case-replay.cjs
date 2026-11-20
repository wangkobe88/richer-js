#!/usr/bin/env node
// T177 案源回放对拍：0x65104a556200d2ac4fc0462c14b240e3ca307777（bt-v147 AF1 复盘）
// 用真实 wss_price_ticks 喂 FA，验证三条 BUY 信号时刻 launchSellBundleClusterSize 读数
// 与 v30 绝对 veto 的判定翻转。
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

const TOKEN = '0x65104a556200d2ac4fc0462c14b240e3ca307777';
const SIGNALS = [
  ['信号1 t0 #1', '2026-10-12T00:15:55Z'],
  ['信号2 t0 #2', '2026-10-12T00:15:58Z'],
  ['信号3 9笔臂', '2026-10-12T00:16:07Z'],
];

async function main() {
  const sb = dbManager.getClient();
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,platform')
    .eq('token_address', TOKEN)
    .gte('block_time', '2026-10-12T00:15:00Z').lte('block_time', '2026-10-12T00:19:00Z')
    .order('block_time', { ascending: true }).limit(500);
  console.log('ticks:', (ticks || []).length);

  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(TOKEN, { createdAtMs: Date.parse(ticks[0].block_time), totalSupply: 1e9, symbol: 'X', creatorAddress: null, platform: 'flap' });
  for (const t of ticks) {
    fa.processTick({
      token_address: TOKEN, trade_type: t.trade_type,
      sender_address: t.sender_address, trader_address: t.trader_address,
      price_bnb: t.price_bnb, price_usd: null, bnb_amount: t.bnb_amount,
      token_amount: t.bnb_amount / t.price_bnb,
      block_number: t.block_number, timestamp: Date.parse(t.block_time),
      tx_hash: '0x' + t.block_number + '_' + t.log_index, log_index: t.log_index,
    });
  }

  const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator.js');
  const ev = new ConditionEvaluator();
  const veto = 'launchBundleClusterSize < 10 AND launchSellBundleClusterSize < 10';

  for (const [name, at] of SIGNALS) {
    const ts = Date.parse(at);
    const m = fa.buildFactorMap(TOKEN, ts);
    console.log(`${name} @${at}: buyClu=${m.launchBundleClusterSize} sellClu=${m.launchSellBundleClusterSize}`
      + ` wave=${m.launchFirstWaveWallets} f0=${m.launchFirstBlockWallets} bigBuy=${m.launchBigBuyBnb}`
      + ` minVsFloor=${m.launchMinVsFloorPct} age=${m.tokenAgeSec}`
      + ` → veto放行=${ev.evaluate(veto, m)}`);
  }

  // 对照：同窗若干其它 token（v147 同窗买过的其它票）不应被误伤——抽验实验全部成交票
  const { data: trs } = await sb.from('trades').select('token_address,profit_percent')
    .eq('experiment_id', '9b31baf4-bdd3-4ebb-9031-2a1603f34633').eq('trade_type', 'buy').limit(100);
  const tokens = [...new Set((trs || []).map(t => t.token_address))];
  console.log('\n对照（同实验全部买点票的新键读数）:');
  for (const tk of tokens) {
    const { data: rows } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
      .eq('token_address', tk)
      .gte('block_time', '2026-10-12T00:00:00Z').lte('block_time', '2026-10-12T23:59:59Z')
      .order('block_time', { ascending: true }).limit(800);
    if (!rows || !rows.length) { console.log(`  ${tk.slice(0, 10)}… 无 ticks`); continue; }
    const f2 = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    f2.registerToken(tk, { createdAtMs: Date.parse(rows[0].block_time), totalSupply: 1e9, symbol: 'Y', creatorAddress: null, platform: 'fourmeme' });
    for (const t of rows) {
      f2.processTick({
        token_address: tk, trade_type: t.trade_type,
        sender_address: t.sender_address, trader_address: t.trader_address,
        price_bnb: t.price_bnb, price_usd: null, bnb_amount: t.bnb_amount,
        token_amount: t.bnb_amount / t.price_bnb,
        block_number: t.block_number, timestamp: Date.parse(t.block_time),
        tx_hash: '0x' + t.block_number + '_' + t.log_index, log_index: t.log_index,
      });
    }
    const { data: sig } = await sb.from('strategy_signals').select('created_at')
      .eq('experiment_id', '9b31baf4-bdd3-4ebb-9031-2a1603f34633').eq('token_address', tk)
      .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1);
    const at = sig && sig[0] ? Date.parse(sig[0].created_at) : Date.parse(rows[rows.length - 1].block_time);
    const m = f2.buildFactorMap(tk, at);
    const pnl = (trs.find(t => t.token_address === tk) || {}).profit_percent;
    console.log(`  ${tk.slice(0, 10)}… buyClu=${m.launchBundleClusterSize} sellClu=${m.launchSellBundleClusterSize}`
      + ` → veto放行=${ev.evaluate(veto, m)} (pnl=${pnl == null ? '-' : (pnl * 100).toFixed(1) + '%'})`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
