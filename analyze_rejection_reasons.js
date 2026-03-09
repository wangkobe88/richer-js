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

async function analyzeRejections() {
  const backtestExpId = 'd951c4b9-6f3a-4784-afd4-cf93525fc914';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', backtestExpId)
    .eq('action', 'buy')
    .in('token_address', [...pumpAndDump, ...notPumpAndDump]);

  console.log('=== 信号失败原因分析 ===\n');
  console.log('条件: earlyTradesCountPerMin >= 30 AND earlyTradesVolumePerMin >= 3200\n');

  const results = [];

  signals.forEach(sig => {
    const addr = sig.token_address;
    const isPump = pumpAndDump.includes(addr);
    const symbol = sig.metadata?.symbol || addr.substring(0, 8);
    const preBuy = sig.metadata?.preBuyCheckFactors || {};

    const countPerMin = preBuy.earlyTradesCountPerMin || 0;
    const volumePerMin = preBuy.earlyTradesVolumePerMin || 0;
    const highValueCount = preBuy.earlyTradesHighValueCount || 0;

    // 检查哪些条件不满足
    const failures = [];
    if (countPerMin < 30) failures.push(`countPerMin=${countPerMin.toFixed(1)} < 30`);
    if (volumePerMin < 3200) failures.push(`volumePerMin=${volumePerMin.toFixed(0)} < 3200`);
    if (highValueCount < 8) failures.push(`highValueCount=${highValueCount} < 8`);

    results.push({
      symbol,
      type: isPump ? 'pump' : 'normal',
      countPerMin,
      volumePerMin,
      highValueCount,
      failures: failures.join(', ')
    });
  });

  // 排序：按 countPerMin 降序
  results.sort((a, b) => b.countPerMin - a.countPerMin);

  console.log('代币名称    | 类型  | countPerMin | volumePerMin | highValueCount | 失败原因');
  console.log('-----------|-------|-------------|--------------|----------------|----------');

  results.forEach(r => {
    console.log(`${r.symbol.substring(0, 10).padEnd(10)} | ${r.type.padEnd(5)} | ${r.countPerMin.toFixed(1).padEnd(11)} | ${r.volumePerMin.toFixed(0).padEnd(12)} | ${r.highValueCount.toString().padEnd(14)} | ${r.failures}`);
  });

  // 统计
  console.log('\n=== 失败原因统计 ===\n');

  const failCount = { countPerMin: 0, volumePerMin: 0, highValueCount: 0 };
  results.forEach(r => {
    if (r.countPerMin < 30) failCount.countPerMin++;
    if (r.volumePerMin < 3200) failCount.volumePerMin++;
    if (r.highValueCount < 8) failCount.highValueCount++;
  });

  console.log(`countPerMin < 30: ${failCount.countPerMin}/${results.length} (${(failCount.countPerMin/results.length*100).toFixed(0)}%)`);
  console.log(`volumePerMin < 3200: ${failCount.volumePerMin}/${results.length} (${(failCount.volumePerMin/results.length*100).toFixed(0)}%)`);
  console.log(`highValueCount < 8: ${failCount.highValueCount}/${results.length} (${(failCount.highValueCount/results.length*100).toFixed(0)}%)`);
}

analyzeRejections().catch(console.error);
