/**
 * 检查 token-early-trades 页面的 API 和回测引擎的数据获取逻辑
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkDataLimit() {
  const tokenAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
  const pairId = `${tokenAddress}_fo-bsc`;

  // 1. 从数据库获取信号中的 earlyTradesTotalCount
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('metadata')
    .eq('token_address', tokenAddress)
    .eq('experiment_id', '5072373e-b79d-4d66-b471-03c7c72730ec')
    .limit(1);

  if (signals.length > 0) {
    const factors = signals[0].metadata?.preBuyCheckFactors || {};
    console.log('=== 回测引擎记录的数据 ===');
    console.log('earlyTradesTotalCount:', factors.earlyTradesTotalCount);
    console.log('earlyWhaleTotalTrades:', factors.earlyWhaleTotalTrades);
    console.log('earlyTradesCheckTime:', factors.earlyTradesCheckTime);
    console.log('earlyTradesExpectedFirstTime:', factors.earlyTradesExpectedFirstTime);
    console.log('earlyTradesExpectedLastTime:', factors.earlyTradesExpectedLastTime);
    console.log('earlyTradesDataFirstTime:', factors.earlyTradesDataFirstTime);
    console.log('earlyTradesDataLastTime:', factors.earlyTradesDataLastTime);
    console.log('earlyTradesActualSpan:', factors.earlyTradesActualSpan);
    console.log('');

    // 计算理论交易数
    const actualSpan = factors.earlyTradesActualSpan || 0;
    const countPerMin = factors.earlyTradesCountPerMin || 0;
    const theoreticalCount = actualSpan / 60 * countPerMin;
    console.log(`理论交易数（基于时间窗口和频率）: ${theoreticalCount.toFixed(0)}`);
    console.log('');
  }

  // 2. 使用 AveTxAPI 直接查询获取实际交易数
  const { AveTxAPI } = require('./src/core/ave-api');
  const txApi = new AveTxAPI(
    'https://prod.ave-api.com',
    30000,
    process.env.AVE_API_KEY
  );

  // 使用回测时相同的时间范围
  const checkTime = 1773077512;
  const targetFromTime = checkTime - 90;

  console.log('=== AVE API 实际查询 ===');
  console.log('pairId:', pairId);
  console.log('查询时间窗口:', targetFromTime, '-', checkTime, '(90秒)');
  console.log('');

  try {
    // 第一次查询300条
    const trades1 = await txApi.getSwapTransactions(pairId, 300, targetFromTime, checkTime, 'asc');
    console.log('第一次查询 (limit=300):');
    console.log('  返回交易数:', trades1.length);

    if (trades1.length > 0) {
      const firstTime = trades1[0].time;
      const lastTime = trades1[trades1.length - 1].time;
      console.log('  最早交易:', firstTime, '(' + new Date(firstTime * 1000).toLocaleString() + ')');
      console.log('  最晚交易:', lastTime, '(' + new Date(lastTime * 1000).toLocaleString() + ')');

      // 检查是否还有更早的数据
      if (firstTime > targetFromTime) {
        console.log('  ⚠️  还有更早的数据未获取！');
        console.log('  缺失时间:', (firstTime - targetFromTime).toFixed(1), '秒');

        // 尝试获取更早的数据
        const toTime = firstTime - 1;
        const trades2 = await txApi.getSwapTransactions(pairId, 300, targetFromTime, toTime, 'asc');
        console.log('\n第二次查询 (获取更早的数据):');
        console.log('  返回交易数:', trades2.length);

        if (trades2.length > 0) {
          const firstTime2 = trades2[0].time;
          const lastTime2 = trades2[trades2.length - 1].time;
          console.log('  最早交易:', firstTime2, '(' + new Date(firstTime2 * 1000).toLocaleString() + ')');
          console.log('  最晚交易:', lastTime2, '(' + new Date(lastTime2 * 1000).toLocaleString() + ')');

          console.log('\n总交易数:', trades1.length + trades2.length);
        }
      } else {
        console.log('  ✓ 已覆盖完整时间窗口');
      }
    }

    // 尝试获取更大的窗口（模拟页面查询）
    console.log('\n=== 模拟页面查询（更长时间窗口）===');
    const extendedFromTime = checkTime - 600; // 10分钟
    const allTrades = await txApi.getSwapTransactions(pairId, 1000, extendedFromTime, checkTime, 'asc');
    console.log('查询时间窗口:', extendedFromTime, '-', checkTime, '(600秒)');
    console.log('返回交易数:', allTrades.length);

    if (allTrades.length > 0) {
      const firstTime = allTrades[0].time;
      const lastTime = allTrades[allTrades.length - 1].time;
      console.log('实际时间范围:', firstTime, '-', lastTime, `(${(lastTime - firstTime).toFixed(1)}秒)`);

      // 统计前90秒的交易数
      const targetTrades = allTrades.filter(t => t.time >= targetFromTime && t.time <= checkTime);
      console.log('前90秒的交易数:', targetTrades.length);
    }

  } catch (error) {
    console.error('API 查询失败:', error.message);
  }

  // 3. 检查回测引擎的代码逻辑
  console.log('\n=== 需要检查的代码位置 ===');
  console.log('1. EarlyParticipantCheckService.js - 获取早期交易的逻辑');
  console.log('2. BacktestEngine.js - 如何调用 EarlyParticipantCheckService');
  console.log('3. 是否有 limit=300 的硬编码限制');
}

checkDataLimit().catch(console.error);
