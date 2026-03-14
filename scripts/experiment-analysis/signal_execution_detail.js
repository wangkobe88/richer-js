#!/usr/bin/env node

/**
 * 分析信号执行状态的详细原因
 */

const http = require('http');

const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const BASE_URL = 'http://localhost:3010/api';
const MIN_RETURN = 250;

class DataLoader {
  constructor(experimentId, baseUrl = 'http://localhost:3010/api') {
    this.experimentId = experimentId;
    this.baseUrl = baseUrl;
  }

  async request(path) {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${path}`;
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

  async getTokens() {
    const res = await this.request(`/experiment/${this.experimentId}/tokens?limit=10000`);
    return res.tokens || [];
  }

  async getSignals() {
    const res = await this.request(`/experiment/${this.experimentId}/signals?limit=10000`);
    return res.signals || [];
  }
}

function isGoodToken(token, minReturn = 100) {
  const analysisResults = token.analysis_results || token.analysisResults || {};
  const maxChange = analysisResults.max_change_percent || token.highest_return || token.highestReturn || 0;
  return maxChange >= minReturn;
}

async function main() {
  console.log(`🔍 分析实验 ${EXPERIMENT_ID.slice(0, 8)}... 涨幅阈值: ${MIN_RETURN}%\n`);

  const dataLoader = new DataLoader(EXPERIMENT_ID);
  const tokens = await dataLoader.getTokens();
  const signals = await dataLoader.getSignals();

  // 找出好票
  const goodTokens = tokens.filter(token => isGoodToken(token, MIN_RETURN));
  console.log(`找到 ${goodTokens.length} 个好票 (涨幅≥${MIN_RETURN}%)\n`);

  // 按symbol分组
  const bySymbol = {};
  goodTokens.forEach(token => {
    const symbol = token.token_symbol || 'Unknown';
    if (!bySymbol[symbol]) {
      bySymbol[symbol] = [];
    }
    bySymbol[symbol].push(token);
  });

  // 分析每个symbol的信号状态
  const results = [];

  for (const [symbol, tokenList] of Object.entries(bySymbol)) {
    const maxChange = Math.max(...tokenList.map(t => {
      const analysisResults = t.analysis_results || t.analysisResults || {};
      return analysisResults.max_change_percent || 0;
    }));

    // 查找该symbol的所有买入信号
    const symbolSignals = signals.filter(s =>
      s.token_symbol === symbol && s.strategy_type === 'buy'
    );

    if (symbolSignals.length === 0) {
      results.push({
        symbol,
        maxChange,
        signalCount: 0,
        executedCount: 0,
        status: '无信号',
        details: '从未触发买入信号'
      });
      continue;
    }

    // 检查信号执行状态
    const executedSignals = symbolSignals.filter(s => s.executed === true);
    const rejectedSignals = symbolSignals.filter(s => s.executed === false);
    const pendingSignals = symbolSignals.filter(s => s.executed === null || s.executed === undefined);

    let status = '';
    let details = [];
    let executionReasons = [];

    if (executedSignals.length > 0) {
      status = '已执行';
      details.push(`已执行${executedSignals.length}个信号`);
    } else if (rejectedSignals.length > 0) {
      status = '被拒绝';
      for (const sig of rejectedSignals) {
        const metadata = sig.metadata || {};
        const reason = sig.execution_reason ||
                      metadata.execution_reason ||
                      metadata.preBuyCheckResult?.reason ||
                      metadata.preBuyCheckFactors?.execution_reason ||
                      '原因未知';
        executionReasons.push(reason);
      }
      details.push(`拒绝原因: ${executionReasons.join('; ')}`);
    } else if (pendingSignals.length > 0) {
      status = '未决定';
      details.push(`有${pendingSignals.length}个信号但executed状态为null`);
    }

    results.push({
      symbol,
      maxChange,
      signalCount: symbolSignals.length,
      executedCount: executedSignals.length,
      rejectedCount: rejectedSignals.length,
      pendingCount: pendingSignals.length,
      status,
      details: details.join(' | '),
      executionReasons
    });
  }

  // 按涨幅排序
  results.sort((a, b) => b.maxChange - a.maxChange);

  // 打印表格
  console.log('═'.repeat(140));
  console.log('【漏掉的好票 - 信号执行状态详情】');
  console.log('═'.repeat(140));
  console.log(`序号  代币名称              最高涨幅    信号数  执行  拒绝  未决定  状态         详情`);
  console.log('─'.repeat(140));

  results.forEach((r, idx) => {
    const statusBadge = {
      '已执行': '✅已执行',
      '被拒绝': '❌被拒绝',
      '无信号': '⭕无信号',
      '未决定': '❓未决定'
    }[r.status] || r.status;

    const shortDetails = (r.details || '').length > 55 ? (r.details || '').slice(0, 52) + '...' : (r.details || '');

    console.log(
      (idx + 1).toString().padStart(3) + '  ' +
      (r.symbol || '').padEnd(20) + '  ' +
      '+' + (r.maxChange || 0).toFixed(1).padStart(6) + '%  ' +
      (r.signalCount || 0).toString().padStart(4) + '  ' +
      (r.executedCount || 0).toString().padStart(4) + '  ' +
      (r.rejectedCount || 0).toString().padStart(4) + '  ' +
      (r.pendingCount || 0).toString().padStart(6) + '  ' +
      statusBadge.padEnd(10) + '  ' +
      shortDetails
    );
  });

  // 统计汇总
  console.log('\n');
  console.log('═'.repeat(140));
  console.log('【统计汇总】');
  console.log('═'.repeat(140));

  const executed = results.filter(r => r.status === '已执行');
  const rejected = results.filter(r => r.status === '被拒绝');
  const noSignal = results.filter(r => r.status === '无信号');
  const pending = results.filter(r => r.status === '未决定');

  console.log(`已执行:   ${executed.length} 个 (${(executed.length / results.length * 100).toFixed(1)}%)`);
  console.log(`被拒绝:   ${rejected.length} 个 (${(rejected.length / results.length * 100).toFixed(1)}%)`);
  console.log(`无信号:   ${noSignal.length} 个 (${(noSignal.length / results.length * 100).toFixed(1)}%)`);
  if (pending.length > 0) {
    console.log(`未决定:   ${pending.length} 个 (${(pending.length / results.length * 100).toFixed(1)}%)`);
  }
  console.log(`总计:     ${results.length} 个`);

  // 拒绝原因汇总
  if (rejected.length > 0) {
    console.log('\n');
    console.log('═'.repeat(140));
    console.log('【拒绝原因分类】');
    console.log('═'.repeat(140));

    const reasonGroups = {};
    rejected.forEach(r => {
      r.executionReasons.forEach(reason => {
        if (!reasonGroups[reason]) {
          reasonGroups[reason] = [];
        }
        reasonGroups[reason].push(r.symbol);
      });
    });

    for (const [reason, symbols] of Object.entries(reasonGroups)) {
      console.log(`\n【${reason}】(${symbols.length}个)`);
      console.log(`  ${symbols.join(', ')}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
