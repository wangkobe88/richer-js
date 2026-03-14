#!/usr/bin/env node

/**
 * 正确分析预检查拒绝原因
 * 对比实际因子值与条件要求
 */

const http = require('http');

const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const BASE_URL = 'http://localhost:3010/api';
const MIN_RETURN = 250;

// 预检查条件定义
const PRECHECK_CONDITIONS = {
  holderBlacklistCount: { name: '黑名单持有人数', condition: '<= 5', check: (v) => v <= 5 },
  holderWhitelistRatio: { name: '白名单/黑名单比例', condition: '>= 黑名单*2', requires: ['holderBlacklistCount', 'holderWhitelistCount'], check: (f) => f.holderWhitelistCount >= f.holderBlacklistCount * 2 },
  devHoldingRatio: { name: '开发者持仓比例', condition: '<= 15%', check: (v) => v <= 15 },
  maxHoldingRatio: { name: '最大持仓比例', condition: '< 18%', check: (v) => v < 18 },
  earlyTradesHighValueCount: { name: '早期高额交易笔数', condition: '>= 8', check: (v) => v >= 8 },
  earlyTradesHighValuePerMin: { name: '早期高额交易频率', condition: '>= 10', check: (v) => v >= 10 },
  earlyTradesCountPerMin: { name: '早期交易频率下限', condition: '>= 30', check: (v) => v >= 30 },
  earlyTradesCountPerMinUpper: { name: '早期交易频率上限', condition: '< 150', check: (v) => v < 150 },
  earlyTradesVolumePerMin: { name: '早期交易量', condition: '>= 3200', check: (v) => v >= 3200 },
  earlyTradesActualSpan: { name: '早期交易跨度', condition: '>= 60秒', check: (v) => v >= 60 },
  walletClusterMaxBlockBuyRatio: { name: '区块最大购买比例', condition: '< 0.15', check: (v) => v < 0.15 },
  walletClusterCheck: { name: '钱包聚簇检测', condition: 'count<4 OR top2<=0.85', requires: ['walletClusterCount', 'walletClusterTop2Ratio'], check: (f) => f.walletClusterCount < 4 || f.walletClusterTop2Ratio <= 0.85 },
  creatorIsNotBadDevWallet: { name: '创建者钱包检测', condition: '>= 1', check: (v) => v >= 1 },
  drawdownFromHighest: { name: '回撤检测', condition: '> -25%', check: (v) => v > -25 }
};

async function request(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
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

function analyzePreCheckFailure(factors) {
  const failedConditions = [];

  for (const [key, config] of Object.entries(PRECHECK_CONDITIONS)) {
    let value, passed;

    if (config.requires) {
      // 需要多个因子值
      value = {};
      config.requires.forEach(r => value[r] = factors[r]);
      passed = config.check(factors);
    } else {
      value = factors[key];
      passed = config.check(value);
    }

    if (!passed) {
      failedConditions.push({
        name: config.name,
        condition: config.condition,
        actual: value,
        key
      });
    }
  }

  return failedConditions;
}

async function main() {
  console.log(`🔍 分析预检查拒绝原因（正确版本）... 涨幅阈值: ${MIN_RETURN}%\n`);

  // 获取数据
  const tokensRes = await request(`/experiment/${EXPERIMENT_ID}/tokens?limit=10000`);
  const tokens = tokensRes.tokens || [];

  const signalsRes = await request(`/experiment/${EXPERIMENT_ID}/signals?limit=10000`);
  const signals = signalsRes.signals || [];

  // 找出好票
  const goodTokens = tokens.filter(token => {
    const analysisResults = token.analysis_results || token.analysisResults || {};
    const maxChange = analysisResults.max_change_percent || 0;
    return maxChange >= MIN_RETURN;
  });

  // 按symbol分组
  const bySymbol = {};
  goodTokens.forEach(token => {
    const symbol = token.token_symbol || 'Unknown';
    if (!bySymbol[symbol]) {
      bySymbol[symbol] = [];
    }
    bySymbol[symbol].push(token);
  });

  // 分析每个symbol
  const results = [];

  for (const [symbol, tokenList] of Object.entries(bySymbol)) {
    const maxChange = Math.max(...tokenList.map(t => {
      const analysisResults = t.analysis_results || t.analysisResults || {};
      return analysisResults.max_change_percent || 0;
    }));

    // 查找被拒绝的信号
    const rejectedSignals = signals.filter(s =>
      s.token_symbol === symbol &&
      s.executed === false &&
      (s.strategy_type === 'buy' || s.strategy_type === null || s.strategy_type === undefined)
    );

    if (rejectedSignals.length === 0) {
      // 没有被拒绝的信号，检查是否已执行或无信号
      const executedSignals = signals.filter(s =>
        s.token_symbol === symbol && s.executed === true
      );
      if (executedSignals.length > 0) {
        results.push({
          symbol,
          maxChange,
          status: '已执行',
          failedConditions: []
        });
      } else {
        results.push({
          symbol,
          maxChange,
          status: '无信号',
          failedConditions: []
        });
      }
      continue;
    }

    // 分析拒绝原因（使用第一个被拒绝的信号）
    const signal = rejectedSignals[0];
    const factors = signal.metadata?.preBuyCheckFactors || {};
    const failedConditions = analyzePreCheckFailure(factors);

    results.push({
      symbol,
      maxChange,
      status: '被拒绝',
      failedConditions
    });
  }

  // 按涨幅排序
  results.sort((a, b) => b.maxChange - a.maxChange);

  // 打印表格
  console.log('═'.repeat(160));
  console.log('【漏掉的好票 - 预检查拒绝原因正确分析】');
  console.log('═'.repeat(160));
  console.log(`序号   代币名称              最高涨幅    状态         不满足的条件`);
  console.log('─'.repeat(160));

  let executedCount = 0;
  let rejectedCount = 0;
  let noSignalCount = 0;
  const conditionStats = {};

  results.forEach((r, idx) => {
    if (r.status === '已执行') executedCount++;
    else if (r.status === '被拒绝') rejectedCount++;
    else noSignalCount++;

    const statusBadge = {
      '已执行': '✅已执行',
      '被拒绝': '❌被拒绝',
      '无信号': '⭕无信号'
    }[r.status] || r.status;

    const failedText = r.failedConditions.length > 0
      ? r.failedConditions.map(c => `${c.name}`).join(', ')
      : '-';

    console.log(
      (idx + 1).toString().padStart(3) + '   ' +
      r.symbol.padEnd(20) + '  ' +
      '+' + r.maxChange.toFixed(1).padStart(6) + '%  ' +
      statusBadge.padStart(8) + '  ' +
      failedText
    );

    // 统计原因
    if (r.status === '被拒绝') {
      r.failedConditions.forEach(c => {
        conditionStats[c.name] = (conditionStats[c.name] || 0) + 1;
      });
    }
  });

  console.log('\n');
  console.log('═'.repeat(160));
  console.log('【统计汇总】');
  console.log('═'.repeat(160));
  console.log(`总好票数:     ${results.length}`);
  console.log(`已执行:       ${executedCount} (${(executedCount / results.length * 100).toFixed(1)}%)`);
  console.log(`被拒绝:       ${rejectedCount} (${(rejectedCount / results.length * 100).toFixed(1)}%)`);
  console.log(`无信号:       ${noSignalCount} (${(noSignalCount / results.length * 100).toFixed(1)}%)`);

  // 拒绝原因汇总
  if (Object.keys(conditionStats).length > 0) {
    console.log('\n');
    console.log('═'.repeat(160));
    console.log('【拒绝原因出现频率】(按条件不满足的次数统计)');
    console.log('═'.repeat(160));

    const sortedReasons = Object.entries(conditionStats).sort((a, b) => b[1] - a[1]);
    sortedReasons.forEach(([reason, count]) => {
      const percent = (count / rejectedCount * 100).toFixed(1);
      console.log(`  ${reason.padEnd(30)} ${count.toString().padStart(3)} 次 (${percent}%)`);
    });
  }

  // 详细展示一个被拒绝代币的完整因子值
  const firstRejected = results.find(r => r.status === '被拒绝' && r.failedConditions.length > 0);
  if (firstRejected) {
    const rejectedSignal = signals.find(s =>
      s.token_symbol === firstRejected.symbol &&
      s.executed === false
    );
    if (rejectedSignal?.metadata?.preBuyCheckFactors) {
      console.log('\n');
      console.log('═'.repeat(160));
      console.log(`【示例：${firstRejected.symbol} (+${firstRejected.maxChange.toFixed(1)}%) 的预检查因子值】`);
      console.log('═'.repeat(160));

      const factors = rejectedSignal.metadata.preBuyCheckFactors;
      const relevantFactors = [
        'holderBlacklistCount', 'holderWhitelistCount', 'devHoldingRatio', 'maxHoldingRatio',
        'earlyTradesHighValueCount', 'earlyTradesHighValuePerMin', 'earlyTradesCountPerMin',
        'earlyTradesVolumePerMin', 'earlyTradesActualSpan', 'walletClusterMaxBlockBuyRatio',
        'walletClusterCount', 'walletClusterTop2Ratio', 'creatorIsNotBadDevWallet', 'drawdownFromHighest'
      ];

      relevantFactors.forEach(key => {
        const value = factors[key];
        const config = Object.values(PRECHECK_CONDITIONS).find(c => c.key === key || (config => config.requires?.includes(key)));
        console.log(`  ${key.padEnd(35)} = ${value}`);
      });
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
