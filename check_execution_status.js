require('dotenv').config({ path: 'config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const pumpAndDump = [
  '0x2be52e98e45ed3d27f56284972b3545dac964444',
  '0x281f05868b5ba9e55869541a117ebb661f474444',
  '0xf3372a3dbc824f0b0044ca77209559514b294444',
  '0xb9b1142a28fade5771b7ae076c96c3bee8beffff',
  '0xd8d4ddeb91987a121422567260a88230dbb34444',
  '0x68b04d6e06495866cc810d4179caf97651a5ffff',
  '0x98fe71847aa16d9e40a4f0e123d172bc71d14444',
  '0x721f5abc0d34948aa0904ba135cc4d9c6ff84444',
  '0xf40dec26ab76df60a761e78c84682d7117a64444',
  '0x0da3a0a3bd66bbeaaa4d35d12cb9ea3725294444'
];

const notPumpAndDump = [
  '0x1443d233e2dbad52df65e6b17063274e6c844444',
  '0x16aeb87aeb78e4cf7987f16e910c285d77354444',
  '0xa9fe96fd5230a135ada220523032b3e1a67d4444',
  '0x4d15d67fcf9bd0b109efa7fc1b150416cca04444',
  '0xd7a23f95c6698c44c7b861408f0d7b47acc74444'
];

async function checkExecutionStatus() {
  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('=== 所有标注代币执行状态（使用execution_status字段）===\n');

  const tokenStats = {};

  signals.forEach(sig => {
    const addr = sig.token_address;
    const isPump = pumpAndDump.includes(addr);
    const status = sig.metadata?.execution_status;
    const tradeCount = sig.metadata?.preBuyCheckFactors?.earlyTradesTotalCount || 0;
    const symbol = sig.metadata?.symbol || addr.substring(0, 8);

    if (!tokenStats[addr]) {
      tokenStats[addr] = { symbol, type: isPump ? 'pump' : 'normal', signals: [] };
    }

    tokenStats[addr].signals.push({ status, tradeCount });
  });

  console.log('代币名称    | 类型  | 信号数 | 执行数 | 未执行数 | 早期交易数');
  console.log('-----------|-------|--------|--------|----------|----------');

  Object.values(tokenStats).forEach(stat => {
    const total = stat.signals.length;
    const executed = stat.signals.filter(s => s.status === 'executed').length;
    const notExecuted = stat.signals.filter(s => s.status !== 'executed').length;
    const trades = stat.signals.map(s => s.tradeCount).sort((a,b) => b-a);
    const tradeRange = trades.length > 0 ? `${trades[0]}-${trades[trades.length-1]}` : '0';

    console.log(`${stat.symbol.substring(0, 10).padEnd(10)} | ${stat.type.padEnd(6)} | ${total}      | ${executed}        | ${notExecuted}        | ${tradeRange}`);
  });

  console.log('\n总结:');
  const pumpTokens = Object.values(tokenStats).filter(s => s.type === 'pump');
  const normalTokens = Object.values(tokenStats).filter(s => s.type === 'normal');

  const pumpExecuted = pumpTokens.filter(t => t.signals.some(s => s.status === 'executed')).length;
  const normalExecuted = normalTokens.filter(t => t.signals.some(s => s.status === 'executed')).length;

  console.log(`拉砸代币: ${pumpExecuted}/${pumpTokens.length} 有执行信号`);
  console.log(`正常代币: ${normalExecuted}/${normalTokens.length} 有执行信号`);

  // 统计总执行信号数
  const totalExecutedSignals = signals.filter(s => s.metadata?.execution_status === 'executed').length;
  console.log(`\n总执行信号数: ${totalExecutedSignals}/${signals.length}`);
}

checkExecutionStatus().catch(console.error);
