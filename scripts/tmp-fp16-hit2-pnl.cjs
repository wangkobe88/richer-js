#!/usr/bin/env node
// 查 FP16 第二命中票 0x04794f99 与贴线票 0x0a32f476 在 bt-v147 的盈亏
const { dbManager } = require('../src/services/dbManager');
const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKENS = ['0x04794f9972e630309a77777e5ec1c5c4a3d67777', '0x0a32f476a0677777777777777777777777777777'].map((x) => x); // 占位，下面用真实值
async function main() {
  const sb = dbManager.getClient();
  // 真实地址从信号行拿（防手敲）
  const { data: sigs } = await sb.from('strategy_signals')
    .select('token_address,token_symbol,created_at')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
    .in('token_address', []).limit(1);
  const { data: all } = await sb.from('strategy_signals')
    .select('token_address,token_symbol')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true).limit(300);
  const want = all.filter((s) => s.token_address.startsWith('0x04794f99') || s.token_address.startsWith('0x0a32f476'));
  for (const s of want) {
    const { data: trs } = await sb.from('trades')
      .select('trade_direction,input_amount,output_amount,unit_price,created_at')
      .eq('experiment_id', EXP).eq('token_address', s.token_address)
      .order('created_at', { ascending: true }).limit(20);
    let buyBnb = 0, sellBnb = 0, lastSellAt = null;
    for (const t of trs || []) {
      if (t.trade_direction === 'buy') buyBnb += Number(t.input_amount || 0);
      else { sellBnb += Number(t.output_amount || 0); lastSellAt = t.created_at; }
    }
    const pnl = sellBnb - buyBnb;
    const open = buyBnb > sellBnb ? '（仍有持仓）' : '';
    console.log(`${s.token_symbol} ${s.token_address}\n  买=${buyBnb.toFixed(4)}B 卖=${sellBnb.toFixed(4)}B pnl=${pnl.toFixed(4)}B ${open} 成交${trs ? trs.length : 0}笔`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
