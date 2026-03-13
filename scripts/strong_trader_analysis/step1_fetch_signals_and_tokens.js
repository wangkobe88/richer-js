/**
 * 步骤1: 获取信号和代币数据
 * 保存中间结果
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OUTPUT_DIR = path.join(__dirname, 'data');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function main() {
  console.log('=== 步骤1: 获取信号和代币数据 ===\n');

  const expId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  // 获取执行的买入信号
  console.log('获取执行的买入信号...');
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, created_at, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .eq('executed', true)
    .order('created_at', { ascending: true });

  if (signalError) {
    console.error('获取信号失败:', signalError);
    return;
  }

  console.log(`  找到 ${signals.length} 个执行的买入信号\n`);

  // 提取唯一代币地址
  const tokenAddresses = [...new Set(signals.map(s => s.token_address))];

  // 获取代币数据（main_pair 和质量标注）
  console.log('获取代币数据...');
  const { data: tokens, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, raw_api_data, human_judges')
    .eq('experiment_id', expId)
    .in('token_address', tokenAddresses);

  if (tokenError) {
    console.error('获取代币失败:', tokenError);
    return;
  }

  console.log(`  找到 ${tokens.length} 个代币\n`);

  // 构建代币映射
  const tokenMap = new Map();
  for (const token of tokens) {
    const mainPair = token.raw_api_data?.main_pair || null;
    const qualityLabel = token.human_judges?.category || null;
    tokenMap.set(token.token_address.toLowerCase(), {
      symbol: token.token_symbol,
      mainPair,
      qualityLabel
    });
  }

  // 处理信号，添加代币信息
  const enrichedSignals = signals.map(signal => {
    const tokenAddr = signal.token_address.toLowerCase();
    const tokenInfo = tokenMap.get(tokenAddr) || {};
    return {
      id: signal.id,
      token_address: signal.token_address,
      token_symbol: signal.token_symbol,
      created_at: signal.created_at,
      timestamp: signal.metadata?.preBuyCheckFactors?.earlyTradesCheckTime ||
                signal.metadata?.timestamp ||
                Math.floor(new Date(signal.created_at).getTime() / 1000),
      main_pair: tokenInfo.mainPair,
      quality_label: tokenInfo.qualityLabel
    };
  });

  // 统计质量标注分布
  const qualityStats = {};
  enrichedSignals.forEach(s => {
    const q = s.quality_label || 'unlabeled';
    qualityStats[q] = (qualityStats[q] || 0) + 1;
  });

  console.log('质量标注分布:');
  for (const [quality, count] of Object.entries(qualityStats)) {
    console.log(`  ${quality}: ${count}`);
  }

  // 保存数据
  const output = {
    experiment_id: expId,
    total_signals: enrichedSignals.length,
    unique_tokens: tokenAddresses.length,
    quality_distribution: qualityStats,
    signals: enrichedSignals,
    tokens: tokens.map(t => ({
      token_address: t.token_address,
      token_symbol: t.token_symbol,
      main_pair: t.raw_api_data?.main_pair,
      quality_label: t.human_judges?.category
    }))
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'step1_signals_and_tokens.json'),
    JSON.stringify(output, null, 2)
  );

  console.log(`\n✅ 数据已保存到 data/step1_signals_and_tokens.json`);
  console.log(`   - 信号数: ${enrichedSignals.length}`);
  console.log(`   - 唯一代币数: ${tokenAddresses.length}`);
  console.log(`   - 有质量标注: ${Object.values(qualityStats).reduce((a, b) => a + b, 0) - (qualityStats.unlabeled || 0)}`);
}

main().catch(console.error);
