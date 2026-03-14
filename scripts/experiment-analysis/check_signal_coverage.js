#!/usr/bin/env node

/**
 * 检查好票是否有策略分析数据
 * 了解为什么没有创建信号
 */

const http = require('http');

const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const BASE_URL = 'http://localhost:3010/api';
const MIN_RETURN = 250;

async function request(path) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:3010/api${path}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON解析失败: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`🔍 检查好票的策略分析数据覆盖情况... 涨幅阈值: ${MIN_RETURN}%\n`);

  // 获取代币数据
  const tokensRes = await request(`/experiment/${EXPERIMENT_ID}/tokens?limit=10000`);
  const tokens = tokensRes.tokens || [];

  // 获取信号数据
  const signalsRes = await request(`/experiment/${EXPERIMENT_ID}/signals?limit=10000`);
  const signals = signalsRes.signals || [];

  // 找出好票
  const goodTokens = tokens.filter(token => {
    const analysisResults = token.analysis_results || token.analysisResults || {};
    const maxChange = analysisResults.max_change_percent || 0;
    return maxChange >= MIN_RETURN;
  });

  console.log(`找到 ${goodTokens.length} 个好票\n`);

  // 按symbol分组
  const bySymbol = {};
  goodTokens.forEach(token => {
    const symbol = token.token_symbol || 'Unknown';
    if (!bySymbol[symbol]) {
      bySymbol[symbol] = [];
    }
    bySymbol[symbol].push(token);
  });

  // 检查每个symbol的策略分析数据
  const results = [];

  for (const [symbol, tokenList] of Object.entries(bySymbol)) {
    const maxChange = Math.max(...tokenList.map(t => {
      const analysisResults = t.analysis_results || t.analysisResults || {};
      return analysisResults.max_change_percent || 0;
    }));

    // 检查是否有信号
    const hasSignal = signals.some(s => s.token_symbol === symbol);

    // 检查第一个token的策略分析数据
    const tokenAddress = tokenList[0].token_address;
    let hasTimeSeries = false;
    let timePointsCount = 0;
    let everSatisfied = false;

    try {
      const params = new URLSearchParams({
        experimentId: EXPERIMENT_ID,
        tokenAddress,
        strategyType: 'buy',
        strategyIndex: '0'
      });
      const analysisRes = await request(`/experiment/strategy-analysis?${params}`);
      const analysisData = analysisRes.data;

      if (analysisData && analysisData.timePoints && analysisData.timePoints.length > 0) {
        hasTimeSeries = true;
        timePointsCount = analysisData.timePoints.length;
        everSatisfied = analysisData.timePoints.some(tp => tp.satisfied === true);
      }
    } catch (e) {
      // 无数据
    }

    // 检查监控池状态
    let monitoringStatus = '未知';
    const firstToken = tokenList[0];
    if (firstToken.monitored_at !== undefined || firstToken.monitoredAt !== undefined) {
      monitoringStatus = '曾进入监控池';
    } else if (firstToken.added_to_pool_at !== undefined) {
      monitoringStatus = '曾进入监控池';
    } else {
      monitoringStatus = '可能未进入监控池';
    }

    results.push({
      symbol,
      maxChange,
      hasSignal,
      hasTimeSeries,
      timePointsCount,
      everSatisfied,
      monitoringStatus
    });
  }

  // 按涨幅排序
  results.sort((a, b) => b.maxChange - a.maxChange);

  // 打印表格
  console.log('═'.repeat(130));
  console.log('【好票信号覆盖分析】');
  console.log('═'.repeat(130));
  console.log(`序号  代币名称              最高涨幅    有信号  有时序数据  时序点数  曾满足条件  监控状态`);
  console.log('─'.repeat(130));

  let withSignal = 0;
  let withTimeSeries = 0;
  let everSatisfiedCount = 0;

  results.forEach((r, idx) => {
    if (r.hasSignal) withSignal++;
    if (r.hasTimeSeries) withTimeSeries++;
    if (r.everSatisfied) everSatisfiedCount++;

    console.log(
      (idx + 1).toString().padStart(3) + '  ' +
      r.symbol.padEnd(20) + '  ' +
      '+' + r.maxChange.toFixed(1).padStart(6) + '%  ' +
      (r.hasSignal ? '✅' : '❌').padStart(6) + '  ' +
      (r.hasTimeSeries ? '✅' : '❌').padStart(8) + '  ' +
      (r.timePointsCount > 0 ? r.timePointsCount.toString().padStart(6) : '-'.padStart(6)) + '  ' +
      (r.everSatisfied ? '✅是' : '❌否').padStart(8) + '  ' +
      r.monitoringStatus
    );
  });

  console.log('\n');
  console.log('═'.repeat(130));
  console.log('【统计汇总】');
  console.log('═'.repeat(130));
  console.log(`总好票数:       ${results.length}`);
  console.log(`有信号:         ${withSignal} (${(withSignal / results.length * 100).toFixed(1)}%)`);
  console.log(`有时序数据:     ${withTimeSeries} (${(withTimeSeries / results.length * 100).toFixed(1)}%)`);
  console.log(`曾满足条件:     ${everSatisfiedCount} (${(everSatisfiedCount / results.length * 100).toFixed(1)}%)`);
  console.log(`\n注意: 有时序数据表示代币进入了监控池，但可能因为买入条件不满足而没有创建信号`);

  // 详细分析：有时序数据但没有信号的代币
  const withTimeSeriesNoSignal = results.filter(r => r.hasTimeSeries && !r.hasSignal && !r.everSatisfied);
  if (withTimeSeriesNoSignal.length > 0) {
    console.log('\n');
    console.log('═'.repeat(130));
    console.log(`【重点分析：进入监控池但从未满足买入条件的代币】(${withTimeSeriesNoSignal.length}个)`);
    console.log('═'.repeat(130));

    for (const r of withTimeSeriesNoSignal) {
      console.log(`\n${r.symbol} (+${r.maxChange.toFixed(1)}%) - ${r.timePointsCount}个时序点`);
    }
  }

  // 详细分析：有时序数据且曾满足条件但没有信号的代币
  const satisfiedButNoSignal = results.filter(r => r.hasTimeSeries && !r.hasSignal && r.everSatisfied);
  if (satisfiedButNoSignal.length > 0) {
    console.log('\n');
    console.log('═'.repeat(130));
    console.log(`【异常：曾满足买入条件但没有创建信号的代币】(${satisfiedButNoSignal.length}个)`);
    console.log('═'.repeat(130));

    for (const r of satisfiedButNoSignal) {
      console.log(`  ${r.symbol} (+${r.maxChange.toFixed(1)}%) - ${r.timePointsCount}个时序点`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
