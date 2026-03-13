/**
 * 步骤1: 获取信号和代币数据
 * 支持命令行参数输入实验ID
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
  // 从命令行获取实验ID
  const expId = process.argv[2];

  if (!expId) {
    console.error('用法: node step1_fetch_signals_and_tokens.js <实验ID>');
    console.error('示例: node step1_fetch_signals_and_tokens.js 4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1');
    process.exit(1);
  }

  console.log('=== 步骤1: 获取信号和代币数据 ===');
  console.log(`实验ID: ${expId}\n`);

  // 获取执行的买入信号
  console.log('获取执行的买入信号...');
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('id, token_address, token_symbol, created_at, metadata')
    .eq('experiment_id', expId)
    .eq('action', 'buy')
    .not('metadata->execution_status', 'is', null)
    .order('created_at', { ascending: true });

  if (signalError) {
    console.error('获取信号失败:', signalError);
    process.exit(1);
  }

  // 过滤已执行的信号
  const executedSignals = signals.filter(s =>
    s.metadata?.execution_status === 'executed' ||
    s.metadata?.executed === true
  );

  console.log(`  找到 ${executedSignals.length} 个执行的买入信号\n`);

  if (executedSignals.length === 0) {
    console.error('没有找到已执行的买入信号');
    process.exit(1);
  }

  // 提取唯一代币地址
  const tokenAddresses = [...new Set(executedSignals.map(s => s.token_address))];

  // 获取代币数据（main_pair 和质量标注）
  console.log('获取代币数据...');
  const { data: tokens, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, raw_api_data, human_judges')
    .eq('experiment_id', expId)
    .in('token_address', tokenAddresses);

  if (tokenError) {
    console.error('获取代币失败:', tokenError);
    process.exit(1);
  }

  console.log(`  找到 ${tokens?.length || 0} 个代币\n`);

  // 构建代币映射
  const tokenMap = new Map();
  for (const token of tokens || []) {
    const mainPair = token.raw_api_data?.main_pair || null;
    const qualityLabel = token.human_judges?.category || null;
    tokenMap.set(token.token_address.toLowerCase(), {
      symbol: token.token_symbol,
      mainPair,
      qualityLabel
    });
  }

  // 处理信号，添加代币信息
  const enrichedSignals = executedSignals.map(signal => {
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

  // 统计有 main_pair 的信号
  const withMainPair = enrichedSignals.filter(s => s.main_pair);
  console.log(`\n有 main_pair 的信号: ${withMainPair.length}/${enrichedSignals.length}`);

  if (withMainPair.length === 0) {
    console.error('警告: 没有找到任何 main_pair 数据，可能无法继续获取交易数据');
  }

  // 保存数据
  const outputFile = path.join(OUTPUT_DIR, 'step1_signals_and_tokens.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    experiment_id: expId,
    created_at: new Date().toISOString(),
    total_signals: enrichedSignals.length,
    signals_with_main_pair: withMainPair.length,
    quality_distribution: qualityStats,
    signals: enrichedSignals
  }, null, 2));

  console.log(`\n✅ 数据已保存到 ${outputFile}`);
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
