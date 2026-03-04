const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeBuy() {
  const experimentId = 'dea2badf-4bbf-4eac-9a10-f6bf9dcc9717';
  const tokenAddress = '0xcd0827aa744903bfba63bb886da82e442f244444';

  // 获取时序数据（买入时间点附近）
  const buyTime = new Date('2026-03-04T08:51:34.179Z').getTime();

  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true });

  console.log('买入信号时间: 2026-03-04T08:51:34');
  console.log('');
  console.log('时序数据（买入前后）:');
  console.log('Loop\t时间\t\t价格\t\ttrendReturn\t趋势说明');
  console.log(''.padEnd(100, '-'));

  // 找到买入时间点附近的数据
  const buyIndex = tsData.findIndex(d => Math.abs(new Date(d.timestamp).getTime() - buyTime) < 5000);

  // 显示从开始到买入后的数据
  const startIdx = Math.max(0, buyIndex - 10);
  const endIdx = Math.min(tsData.length, buyIndex + 5);

  for (let i = startIdx; i < endIdx; i++) {
    const d = tsData[i];
    const fv = d.factor_values || {};
    const trendReturn = fv.trendTotalReturn ?? 'N/A';
    const dataPoints = fv.trendDataPoints ?? 0;
    const timeStr = new Date(d.timestamp).toISOString().substring(11, 19);
    const marker = i === buyIndex ? ' <-- 买入' : '';

    console.log(`${d.loop_count}\t${timeStr}\t${d.price_usd}\t${typeof trendReturn === 'number' ? trendReturn.toFixed(2) + '%' : trendReturn}\t\tdataPoints=${dataPoints}${marker}`);
  }

  console.log('');
  console.log('关键分析:');
  console.log('1. collectionPrice: 0.0000040275 (收集时价格)');
  console.log('2. currentPrice: 0.0000043291 (买入时价格)');
  console.log('3. earlyReturn: 9.47% (从收集到买入的涨幅)');
  console.log('4. trendTotalReturn: 7.49% (价格历史缓存计算)');
  console.log('');
  console.log('趋势检测指标（买入时）:');
  console.log('  - trendCV: 0.0259 > 0.005 ✓ (波动性足够)');
  console.log('  - trendDirectionCount: 2 >= 2 ✓ (方向确认)');
  console.log('  - trendStrengthScore: 70.6 > 30 ✓ (强度足够)');
  console.log('  - trendTotalReturn: 7.49% > 5% ✓ (收益足够)');
  console.log('  - trendRiseRatio: 16.67% < 50% ✗ (上涨占比不足)');
  console.log('');
  console.log('问题：用户看到的价格走势是下降的，为什么趋势指标显示上升？');
}

analyzeBuy();
