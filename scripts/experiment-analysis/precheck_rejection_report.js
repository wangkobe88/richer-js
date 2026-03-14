#!/usr/bin/env node

/**
 * 生成预检查拒绝原因详细报告
 */

const http = require('http');

const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const BASE_URL = 'http://localhost:3010/api';
const MIN_RETURN = 250;

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

function parsePreCheckReason(reason) {
  // 解析预检查拒绝原因
  if (!reason) return ['未知原因'];

  const reasons = [];

  // holderBlacklistCount <= 5
  if (reason.includes('holderBlacklistCount')) {
    reasons.push('黑名单持有人数');
  }

  // holderWhitelistCount >= holderBlacklistCount * 2
  if (reason.includes('holderWhitelistCount')) {
    reasons.push('白名单/黑名单比例');
  }

  // devHoldingRatio <= 15
  if (reason.includes('devHoldingRatio')) {
    reasons.push('开发者持仓比例');
  }

  // maxHoldingRatio < 18
  if (reason.includes('maxHoldingRatio')) {
    reasons.push('最大持仓比例');
  }

  // earlyTradesHighValueCount >= 8
  if (reason.includes('earlyTradesHighValueCount')) {
    reasons.push('早期高额交易笔数');
  }

  // earlyTradesHighValuePerMin >= 10
  if (reason.includes('earlyTradesHighValuePerMin')) {
    reasons.push('早期高额交易频率');
  }

  // earlyTradesCountPerMin >= 30
  if (reason.includes('earlyTradesCountPerMin >= 30')) {
    reasons.push('早期交易频率下限');
  }

  // earlyTradesCountPerMin < 150
  if (reason.includes('earlyTradesCountPerMin < 150')) {
    reasons.push('早期交易频率上限');
  }

  // earlyTradesVolumePerMin >= 3200
  if (reason.includes('earlyTradesVolumePerMin')) {
    reasons.push('早期交易量');
  }

  // earlyTradesActualSpan >= 60
  if (reason.includes('earlyTradesActualSpan')) {
    reasons.push('早期交易跨度');
  }

  // walletClusterMaxBlockBuyRatio < 0.15
  if (reason.includes('walletClusterMaxBlockBuyRatio')) {
    reasons.push('区块最大购买比例');
  }

  // walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85
  if (reason.includes('walletClusterCount') || reason.includes('walletClusterTop2Ratio')) {
    reasons.push('钱包聚簇检测');
  }

  // creatorIsNotBadDevWallet >= 1
  if (reason.includes('creatorIsNotBadDevWallet')) {
    reasons.push('创建者钱包检测');
  }

  // drawdownFromHighest > -25
  if (reason.includes('drawdownFromHighest')) {
    reasons.push('回撤检测');
  }

  if (reasons.length === 0) {
    reasons.push(reason.slice(0, 50) + '...');
  }

  return reasons;
}

async function main() {
  console.log(`🔍 分析预检查拒绝原因... 涨幅阈值: ${MIN_RETURN}%\n`);

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

    // 查找该symbol的买入信号
    const buySignals = signals.filter(s =>
      s.token_symbol === symbol &&
      (s.strategy_type === 'buy' || s.strategy_type === null || s.strategy_type === undefined)
    );

    if (buySignals.length === 0) {
      results.push({
        symbol,
        maxChange,
        signalCount: 0,
        executedCount: 0,
        status: '无信号',
        reasons: ['未触发买入信号']
      });
      continue;
    }

    // 统计执行状态
    const executedSignals = buySignals.filter(s => s.executed === true);
    const rejectedSignals = buySignals.filter(s => s.executed === false);

    if (executedSignals.length > 0) {
      results.push({
        symbol,
        maxChange,
        signalCount: buySignals.length,
        executedCount: executedSignals.length,
        status: '已执行',
        reasons: []
      });
      continue;
    }

    if (rejectedSignals.length > 0) {
      // 获取拒绝原因
      const rejectionReasons = new Set();
      for (const sig of rejectedSignals) {
        const reason = sig.execution_reason || sig.metadata?.execution_reason || '';
        const parsed = parsePreCheckReason(reason);
        parsed.forEach(r => rejectionReasons.add(r));
      }
      results.push({
        symbol,
        maxChange,
        signalCount: buySignals.length,
        executedCount: 0,
        status: '被拒绝',
        reasons: Array.from(rejectionReasons)
      });
      continue;
    }

    // 有信号但executed为null
    results.push({
      symbol,
      maxChange,
      signalCount: buySignals.length,
      executedCount: 0,
      status: '未决定',
      reasons: ['信号状态未知']
    });
  }

  // 按涨幅排序
  results.sort((a, b) => b.maxChange - a.maxChange);

  // 打印表格
  console.log('═'.repeat(160));
  console.log('【漏掉的好票 - 预检查拒绝原因详细报告】');
  console.log('═'.repeat(160));
  console.log(`序号   代币名称              最高涨幅    信号数  状态         拒绝原因`);
  console.log('─'.repeat(160));

  let executedCount = 0;
  let rejectedCount = 0;
  let noSignalCount = 0;
  const reasonStats = {};

  results.forEach((r, idx) => {
    if (r.status === '已执行') executedCount++;
    else if (r.status === '被拒绝') rejectedCount++;
    else noSignalCount++;

    const statusBadge = {
      '已执行': '✅已执行',
      '被拒绝': '❌被拒绝',
      '无信号': '⭕无信号',
      '未决定': '❓未决定'
    }[r.status] || r.status;

    const reasonsText = r.reasons.length > 0 ? r.reasons.join(', ') : '-';

    console.log(
      (idx + 1).toString().padStart(3) + '   ' +
      r.symbol.padEnd(20) + '  ' +
      '+' + r.maxChange.toFixed(1).padStart(6) + '%  ' +
      r.signalCount.toString().padStart(4) + '  ' +
      statusBadge.padStart(8) + '  ' +
      reasonsText
    );

    // 统计原因
    if (r.status === '被拒绝') {
      r.reasons.forEach(reason => {
        reasonStats[reason] = (reasonStats[reason] || 0) + 1;
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
  if (Object.keys(reasonStats).length > 0) {
    console.log('\n');
    console.log('═'.repeat(160));
    console.log('【拒绝原因出现频率】');
    console.log('═'.repeat(160));

    const sortedReasons = Object.entries(reasonStats).sort((a, b) => b[1] - a[1]);
    sortedReasons.forEach(([reason, count]) => {
      const percent = (count / rejectedCount * 100).toFixed(1);
      console.log(`  ${reason.padEnd(30)} ${count.toString().padStart(3)} 次 (${percent}%)`);
    });
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
