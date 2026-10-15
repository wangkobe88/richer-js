// v18 重建前盘点 3：token 数量净额对账（182 跑）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const V17 = '203570e3-6117-4841-bc50-936461e78a8a';

(async () => {
  const sb = dbManager.getClient();
  const { data: trades, error } = await sb.from('trades')
    .select('token_symbol,trade_direction,input_currency,output_currency,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', V17).order('executed_at').limit(500);
  if (error) { console.log('error:', error.message); return; }
  const net = {};
  for (const t of trades) {
    if (!t.success) continue;
    const k = t.token_symbol || '?';
    // 买：input=BNB output=token；卖：input=token output=BNB
    let tokenAmt = 0;
    if (String(t.trade_direction).toLowerCase() === 'buy') tokenAmt = Number(t.output_amount || 0);
    else tokenAmt = -Number(t.input_amount || 0);
    net[k] = net[k] || { netToken: 0, lastAt: null };
    net[k].netToken += tokenAmt;
    net[k].lastAt = t.executed_at;
  }
  const open = Object.entries(net).filter(([, v]) => Math.abs(v.netToken) / Math.max(1e-18, 1) > 1e-6 && v.netToken > 0);
  console.log('== 净持仓（netToken > 尘量 1e-6）==');
  if (open.length === 0) console.log('（无 —— 全部平仓）');
  for (const [k, v] of open) console.log(`  ${k}: netToken=${v.netToken.toPrecision(8)} last=${v.lastAt}`);
  const dust = Object.entries(net).filter(([, v]) => v.netToken > 0 && v.netToken <= 1e-6);
  if (dust.length) { console.log('尘量残留（≤1e-6，视为已清）:'); for (const [k, v] of dust) console.log(`  ${k}: ${v.netToken}`); }
  const neg = Object.entries(net).filter(([, v]) => v.netToken < 0);
  if (neg.length) { console.log('⚠负净额（异常，需人工看）:'); for (const [k, v] of neg) console.log(`  ${k}: ${v.netToken}`); }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
