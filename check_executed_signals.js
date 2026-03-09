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

async function query() {
  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata, executed')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('=== 信号执行情况统计 ===\n');

  const tokenStats = {};

  signals.forEach(sig => {
    const addr = sig.token_address;
    const isPump = pumpAndDump.includes(addr);
    const executed = sig.metadata?.executed || false;
    const tradeCount = sig.metadata?.preBuyCheckFactors?.earlyTradesTotalCount || 0;
    const symbol = sig.metadata?.symbol || addr.substring(0, 8);

    if (!tokenStats[addr]) {
      tokenStats[addr] = {
        symbol,
        type: isPump ? 'pump' : 'normal',
        total: 0,
        executed: 0,
        tradeCounts: []
      };
    }

    tokenStats[addr].total++;
    if (executed) tokenStats[addr].executed++;
    tokenStats[addr].tradeCounts.push(tradeCount);
  });

  console.log('代币地址      | 代币名称 | 类型  | 信号数 | 执行数 | 早期交易数范围');
  console.log('--------------|----------|-------|--------|--------|----------------');

  Object.values(tokenStats).forEach(stat => {
    const minTrade = Math.min(...stat.tradeCounts);
    const maxTrade = Math.max(...stat.tradeCounts);
    const addr = Object.keys(tokenStats).find(k => tokenStats[k].symbol === stat.symbol);
    console.log(`${addr.substring(0, 12)}... | ${stat.symbol.substring(0, 8).padEnd(8)} | ${stat.type.padEnd(6)} | ${stat.total}      | ${stat.executed}      | ${minTrade}-${maxTrade}`);
  });

  console.log('\n总结:');
  const totalPump = Object.values(tokenStats).filter(s => s.type === 'pump').length;
  const totalNormal = Object.values(tokenStats).filter(s => s.type === 'normal').length;
  const executedPump = Object.values(tokenStats).filter(s => s.type === 'pump' && s.executed > 0).length;
  const executedNormal = Object.values(tokenStats).filter(s => s.type === 'normal' && s.executed > 0).length;

  console.log(`拉砸代币: ${executedPump}/${totalPump} 有执行信号`);
  console.log(`正常代币: ${executedNormal}/${totalNormal} 有执行信号`);
}

query().catch(console.error);
