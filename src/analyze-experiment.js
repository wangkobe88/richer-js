const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeExperiment() {
  const experimentId = '8f688916-a7a7-4501-badc-6cc3a5efc8d8';

  console.log('正在分析实验:', experimentId);
  console.log('='.repeat(80));

  // 获取实验详情
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  console.log('\n【实验信息】');
  console.log('名称:', experiment.experiment_name);
  console.log('描述:', experiment.experiment_description);
  console.log('状态:', experiment.status);
  console.log('模式:', experiment.trading_mode);
  console.log('开始时间:', experiment.started_at);
  console.log('配置:', JSON.stringify(experiment.config, null, 2));

  // 获取所有代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId);

  console.log('\n【代币统计】');
  console.log('总代币数:', tokens.length);
  console.log('状态分布:');
  const statusCount = {};
  tokens.forEach(t => {
    statusCount[t.status] = (statusCount[t.status] || 0) + 1;
  });
  Object.entries(statusCount).forEach(([status, count]) => {
    console.log(`  - ${status}: ${count}`);
  });

  // 分析代币数据
  console.log('\n【代币详情分析】');
  console.log('='.repeat(80));

  // 按状态分组
  const monitoringTokens = tokens.filter(t => t.status === 'monitoring');
  const boughtTokens = tokens.filter(t => t.status === 'bought');
  const exitedTokens = tokens.filter(t => t.status === 'exited');

  console.log('\n1. 已买入的代币 (bought):', boughtTokens.length);
  boughtTokens.forEach(t => {
    console.log(`\n  代币: ${t.token_symbol || 'N/A'}`);
    console.log(`  地址: ${t.token_address}`);
    console.log(`  发现时间: ${t.discovered_at}`);
    if (t.raw_api_data) {
      const apiData = typeof t.raw_api_data === 'string' ? JSON.parse(t.raw_api_data) : t.raw_api_data;
      console.log(`  持有人数: ${apiData.holders || 'N/A'}`);
      console.log(`  推特: ${apiData.twitter || 'N/A'}`);
      console.log(`  FDV: ${apiData.fdv || 'N/A'}`);
      console.log(`  TVL: ${apiData.tvl || 'N/A'}`);
      console.log(`  市值: ${apiData.market_cap || 'N/A'}`);
    }
  });

  console.log('\n2. 已退出的代币 (exited):', exitedTokens.length);
  exitedTokens.forEach(t => {
    console.log(`\n  代币: ${t.token_symbol || 'N/A'}`);
    console.log(`  地址: ${t.token_address}`);
    console.log(`  发现时间: ${t.discovered_at}`);
    if (t.raw_api_data) {
      const apiData = typeof t.raw_api_data === 'string' ? JSON.parse(t.raw_api_data) : t.raw_api_data;
      console.log(`  持有人数: ${apiData.holders || 'N/A'}`);
      console.log(`  推特: ${apiData.twitter || 'N/A'}`);
    }
  });

  console.log('\n3. 监控中的代币 (monitoring):', monitoringTokens.length);
  console.log('前20个:');
  monitoringTokens.slice(0, 20).forEach(t => {
    console.log(`\n  代币: ${t.token_symbol || 'N/A'}`);
    console.log(`  地址: ${t.token_address}`);
    console.log(`  发现时间: ${t.discovered_at}`);
    if (t.raw_api_data) {
      const apiData = typeof t.raw_api_data === 'string' ? JSON.parse(t.raw_api_data) : t.raw_api_data;
      console.log(`  持有人数: ${apiData.holders || 'N/A'}`);
      console.log(`  推特: ${apiData.twitter || 'N/A'}`);
      console.log(`  FDV: ${apiData.fdv || 'N/A'}`);
      console.log(`  TVL: ${apiData.tvl || 'N/A'}`);
    }
  });

  // 获取所有交易
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  console.log('\n【交易分析】');
  console.log('总交易数:', trades.length);
  console.log('成功交易:', trades.filter(t => t.success).length);
  console.log('失败交易:', trades.filter(t => !t.success).length);

  // 分析买入交易
  const buyTrades = trades.filter(t => t.direction === 'buy' && t.success);
  const sellTrades = trades.filter(t => t.direction === 'sell' && t.success);

  console.log('\n买入交易:', buyTrades.length);
  buyTrades.forEach(t => {
    console.log(`\n  代币: ${t.token_symbol || 'N/A'}`);
    console.log(`  地址: ${t.token_address}`);
    console.log(`  数量: ${t.amount}`);
    console.log(`  价格: ${t.price}`);
    console.log(`  时间: ${t.created_at}`);
  });

  console.log('\n卖出交易:', sellTrades.length);
  sellTrades.forEach(t => {
    console.log(`\n  代币: ${t.token_symbol || 'N/A'}`);
    console.log(`  地址: ${t.token_address}`);
    console.log(`  数量: ${t.amount}`);
    console.log(`  价格: ${t.price}`);
    console.log(`  时间: ${t.created_at}`);
  });

  // 获取所有信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false });

  console.log('\n【信号分析】');
  console.log('总信号数:', signals.length);

  const buySignals = signals.filter(s => s.signal_type === 'BUY');
  const sellSignals = signals.filter(s => s.signal_type === 'SELL');

  console.log('买入信号:', buySignals.length);
  console.log('卖出信号:', sellSignals.length);

  console.log('\n最近的买入信号:');
  buySignals.slice(0, 10).forEach(s => {
    console.log(`\n  时间: ${s.created_at}`);
    console.log(`  代币: ${s.token_symbol || 'N/A'}`);
    console.log(`  地址: ${s.token_address}`);
    console.log(`  原因: ${s.reason}`);
    if (s.metadata) {
      const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
      console.log(`  元数据: ${JSON.stringify(meta, null, 2)}`);
    }
  });

  console.log('\n最近的卖出信号:');
  sellSignals.slice(0, 10).forEach(s => {
    console.log(`\n  时间: ${s.created_at}`);
    console.log(`  代币: ${s.token_symbol || 'N/A'}`);
    console.log(`  地址: ${s.token_address}`);
    console.log(`  原因: ${s.reason}`);
    if (s.metadata) {
      const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
      console.log(`  元数据: ${JSON.stringify(meta, null, 2)}`);
    }
  });

  // 保存完整数据到JSON文件
  const analysisData = {
    experiment,
    tokens,
    trades,
    signals
  };

  fs.writeFileSync('/tmp/experiment-analysis.json', JSON.stringify(analysisData, null, 2));
  console.log('\n完整数据已保存到: /tmp/experiment-analysis.json');
}

analyzeExperiment().catch(console.error);
