// 单票事件时间线取证：stallClose 卖出后为何又有卖臂信号
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0x019daea9de9cd5f511dc15046cb077d92e817777';

const c = await dbManager.getClient();

const { data: sigs, error: e1 } = await c.from('strategy_signals')
  .select('id,action,signal_type,executed,reason,created_at,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e1) throw new Error('signals: ' + e1.message);

const { data: trades, error: e2 } = await c.from('trades')
  .select('id,trade_direction,input_amount,output_amount,signal_id,created_at,executed_at,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e2) throw new Error('trades: ' + e2.message);

const { data: exp, error: e3 } = await c.from('experiments')
  .select('*').eq('id', EXP).single();
if (e3) throw new Error('exp: ' + e3.message);

console.log(`experiment=${exp.experiment_name || exp.id} status=${exp.status} platform=${exp.platform}`);
const cfg = exp.config || {};
console.log(`\n=== 实验关键配置 ===`);
console.log(`stallClose=${JSON.stringify(cfg.stallClose || cfg.positionManagement?.stallClose || null)}`);
console.log(`stopLoss=${JSON.stringify(cfg.stopLoss || null)}`);
console.log(`scanIntervalSec=${cfg.stopLoss?.scanIntervalSec ?? cfg.sellScanIntervalSec ?? '(default 30s)'}`);
const legs = cfg.strategiesConfig?.legs || [];
console.log(`\n=== 卖腿（${legs.filter(l => l.side === 'sell').length} 条）===`);
for (const l of legs.filter(l => l.side === 'sell')) {
  console.log(`- [${l.id}] ${l.name}`);
  console.log(`  condition=${l.condition}`);
  if (l.bypassDebounce) console.log(`  bypassDebounce=${l.bypassDebounce}`);
  if (l.sellDebounce) console.log(`  sellDebounce=${JSON.stringify(l.sellDebounce)}`);
}

console.log(`\n=== 信号时间线（${sigs.length} 行）===`);
for (const s of sigs) {
  const md = s.metadata || {};
  console.log(`#${s.id} ${s.created_at} ${s.action}/${s.signal_type} exec=${s.executed} strat=${s.strategy_id || '-'} reason=${s.reason || '-'}`);
  const keys = ['strategyName', 'why', 'sellDebounce', 'debounce', 'stallMs', 'profitPercent', 'currentVsLaunchPct', 'actTotalBnb'];
  const parts = [];
  for (const k of keys) if (md[k] !== undefined) parts.push(`${k}=${JSON.stringify(md[k])}`);
  if (parts.length) console.log(`   md: ${parts.join(' ')}`);
}

console.log(`\n=== 成交时间线（${trades.length} 行）===`);
for (const t of trades) {
  console.log(`#${t.id} ${t.executed_at || t.created_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} signal=${t.signal_id || '-'} strat=${JSON.stringify(t.metadata?.strategyName || t.metadata?.why || null)}`);
}
