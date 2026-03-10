/**
 * 检查哪些信号有 preBuyCheckFactors
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkFactors() {
  const experimentId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('=== 检查前20个信号的 preBuyCheckFactors ===\n');

  let withFactors = 0;
  let withoutFactors = 0;

  signals.forEach((s, i) => {
    const symbol = s.metadata?.symbol || s.token_address.substring(0, 8);
    const hasFactors = s.metadata?.preBuyCheckFactors !== undefined && s.metadata?.preBuyCheckFactors !== null;
    const factors = s.metadata?.preBuyCheckFactors;

    if (hasFactors && factors) {
      console.log(`${i + 1}. ${symbol.padEnd(12)} | ✓ 有数据 | 大户数: ${factors.earlyWhaleCount}, 卖出率: ${(factors.earlyWhaleSellRatio * 100).toFixed(0)}%`);
      withFactors++;
    } else {
      console.log(`${i + 1}. ${symbol.padEnd(12)} | ✗ 无数据`);
      withoutFactors++;
    }
  });

  console.log('');
  console.log('统计:');
  console.log(`有 preBuyCheckFactors: ${withFactors}`);
  console.log(`无 preBuyCheckFactors: ${withoutFactors}`);
}

checkFactors().catch(console.error);
