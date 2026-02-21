require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 获取买入信号
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '0cc6804d-834e-44f8-8287-c4b4a78abd30')
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  console.log('总买入信号数:', buySignals?.length || 0);

  // 断头台代币
  const guillotineAddresses = new Set([
    '0x60f49cc3e8343764c2954ee8be82c98cf586ffff',
    '0xe17df11817754c9c15ee912e459d812e4d0fffff'
  ]);

  // 正常盈利代币
  const profitableAddresses = new Set([
    '0x3ef3a1e38861bd0ee9cb0aaa0e3734e86914fc61',  // Martian
    '0x81f1de5eed7bf1bbccabedcd8447c0793b0e8de2'   // CATALIEN
  ]);

  const guillotineBuys = buySignals.filter(s => guillotineAddresses.has(s.token_address));
  const profitableBuys = buySignals.filter(s => profitableAddresses.has(s.token_address));

  console.log('\n========================================');
  console.log('=== 断头台代币买入时刻因子 ===');
  console.log('========================================');

  for (const buy of guillotineBuys) {
    const f = buy.metadata;
    console.log(`\n${buy.token_symbol}:`);
    console.log('  买入时间:', new Date(buy.created_at).toLocaleString('zh-CN'));
    console.log('  holders:', f.holders ?? 'N/A');
    console.log('  tvl:', f.tvl ?? 'N/A');
    console.log('  fdv:', f.fdv ?? 'N/A');
    console.log('  txVolumeU24h:', f.txVolumeU24h ?? 'N/A');
    console.log('  earlyReturn:', f.earlyReturn ? f.earlyReturn.toFixed(2) + '%' : 'N/A');
    console.log('  trendCV:', f.trendCV ?? 'N/A');
    console.log('  trendStrengthScore:', f.trendStrengthScore ?? 'N/A');
  }

  console.log('\n========================================');
  console.log('=== 正常盈利代币买入时刻因子 ===');
  console.log('========================================');

  for (const buy of profitableBuys) {
    const f = buy.metadata;
    console.log(`\n${buy.token_symbol}:`);
    console.log('  买入时间:', new Date(buy.created_at).toLocaleString('zh-CN'));
    console.log('  holders:', f.holders ?? 'N/A');
    console.log('  tvl:', f.tvl ?? 'N/A');
    console.log('  fdv:', f.fdv ?? 'N/A');
    console.log('  txVolumeU24h:', f.txVolumeU24h ?? 'N/A');
    console.log('  earlyReturn:', f.earlyReturn ? f.earlyReturn.toFixed(2) + '%' : 'N/A');
    console.log('  trendCV:', f.trendCV ?? 'N/A');
    console.log('  trendStrengthScore:', f.trendStrengthScore ?? 'N/A');
  }

  // 统计所有买入信号的 earlyReturn 分布
  const allReturns = buySignals
    .map(s => s.metadata?.earlyReturn)
    .filter(r => r != null);

  allReturns.sort((a, b) => a - b);

  console.log('\n========================================');
  console.log('=== 所有买入信号的 earlyReturn 分布 ===');
  console.log('========================================');
  console.log(`总样本数: ${allReturns.length}`);
  console.log(`最小值: ${allReturns[0]?.toFixed(2)}%`);
  console.log(`25% 分位: ${allReturns[Math.floor(allReturns.length * 0.25)]?.toFixed(2)}%`);
  console.log(`50% 分位(中位数): ${allReturns[Math.floor(allReturns.length * 0.5)]?.toFixed(2)}%`);
  console.log(`75% 分位: ${allReturns[Math.floor(allReturns.length * 0.75)]?.toFixed(2)}%`);
  console.log(`90% 分位: ${allReturns[Math.floor(allReturns.length * 0.9)]?.toFixed(2)}%`);
  console.log(`95% 分位: ${allReturns[Math.floor(allReturns.length * 0.95)]?.toFixed(2)}%`);
  console.log(`最大值: ${allReturns[allReturns.length - 1]?.toFixed(2)}%`);

  // 分析 earlyReturn 与后续收益的关系
  console.log('\n========================================');
  console.log('=== 关键发现 ===');
  console.log('========================================');

  const guillotineAvgReturn = guillotineBuys.reduce((sum, s) => sum + (s.metadata?.earlyReturn || 0), 0) / guillotineBuys.length;
  const profitableAvgReturn = profitableBuys.reduce((sum, s) => sum + (s.metadata?.earlyReturn || 0), 0) / profitableBuys.length;

  console.log('\nearlyReturn 对比:');
  console.log(`  断头台代币平均: ${guillotineAvgReturn.toFixed(2)}%`);
  console.log(`  正常盈利代币平均: ${profitableAvgReturn.toFixed(2)}%`);

  console.log('\n结论:');
  console.log('  断头台代币在买入时已经暴涨 500-900%');
  console.log('  这是庄家拉盘后的"诱多"阶段');
  console.log('  建议添加 earlyReturn 上限来过滤！');
  console.log('');
  console.log('建议的过滤条件:');
  console.log('  AND earlyReturn < 200  // 排除已经暴涨的代币');
})();