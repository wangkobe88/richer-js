#!/usr/bin/env node

/**
 * 生成详细的漏掉的好票报告
 * 按原因分类展示代币和涨幅
 */

const http = require('http');

const EXPERIMENT_ID = '015db965-0b33-4d98-88b1-386203886381';
const BASE_URL = 'http://localhost:3010/api';
const MIN_RETURN = 250; // 250%

class DataLoader {
  constructor(experimentId, baseUrl = 'http://localhost:3010/api') {
    this.experimentId = experimentId;
    this.baseUrl = baseUrl;
    this.cache = new Map();
  }

  async request(path) {
    const cacheKey = path;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${path}`;
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            this.cache.set(cacheKey, json);
            resolve(json);
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  async getTrades() {
    const res = await this.request(`/experiment/${this.experimentId}/trades?limit=10000`);
    return res.trades || [];
  }

  async getTokens() {
    const res = await this.request(`/experiment/${this.experimentId}/tokens?limit=10000`);
    return res.tokens || [];
  }

  async getSignals() {
    const res = await this.request(`/experiment/${this.experimentId}/signals?limit=10000`);
    return res.signals || [];
  }

  async getStrategyAnalysis(tokenAddress) {
    try {
      const params = new URLSearchParams({
        experimentId: this.experimentId,
        tokenAddress,
        strategyType: 'buy',
        strategyIndex: '0'
      });
      const res = await this.request(`/experiment/strategy-analysis?${params}`);
      return res.data || null;
    } catch (e) {
      return null;
    }
  }
}

function isGoodToken(token, minReturn = 100) {
  const analysisResults = token.analysis_results || token.analysisResults || {};
  const maxChange = analysisResults.max_change_percent || token.highest_return || token.highestReturn || 0;
  return maxChange >= minReturn;
}

function analyzeWhyNoSignal(strategyAnalysis) {
  const timePoints = strategyAnalysis?.timePoints || [];
  if (timePoints.length === 0) {
    return { reasons: ['无策略分析数据'] };
  }

  const triggeredPoint = timePoints.find(tp => tp.satisfied === true);
  if (triggeredPoint) {
    return { reasons: ['信号曾触发但未执行'] };
  }

  const latest = timePoints[timePoints.length - 1];
  const factors = latest.data?.factor_values || {};
  const reasons = [];

  if ((factors.trendRiseRatio || 0) < 0.7) {
    reasons.push(`trendRiseRatio=${(factors.trendRiseRatio || 0).toFixed(2)}`);
  }
  if ((factors.age || 0) < 1.2) {
    reasons.push(`age过小=${(factors.age || 0).toFixed(2)}`);
  }
  if ((factors.age || 0) > 10) {
    reasons.push(`age过大=${(factors.age || 0).toFixed(2)}`);
  }
  if ((factors.earlyReturn || 0) < 15) {
    reasons.push(`earlyReturn=${(factors.earlyReturn || 0).toFixed(1)}`);
  }
  if ((factors.drawdownFromHighest || 0) < -25) {
    reasons.push(`回撤=${(factors.drawdownFromHighest || 0).toFixed(1)}`);
  }
  if ((factors.trendCV || 0) < 0.02) {
    reasons.push(`trendCV=${(factors.trendCV || 0).toFixed(3)}`);
  }

  if (reasons.length === 0) {
    reasons.push('未知原因');
  }

  return { reasons };
}

async function main() {
  console.log(`📊 分析实验 ${EXPERIMENT_ID.slice(0, 8)}... 涨幅阈值: ${MIN_RETURN}%\n`);

  const dataLoader = new DataLoader(EXPERIMENT_ID);

  const trades = await dataLoader.getTrades();
  const tokens = await dataLoader.getTokens();
  const signals = await dataLoader.getSignals();

  // 找出被交易过的代币
  const tradedAddresses = new Set(trades.map(t => t.token_address));

  // 找出所有好票
  const goodTokens = tokens.filter(token => {
    if (!isGoodToken(token, MIN_RETURN)) return false;
    return !tradedAddresses.has(token.token_address);
  });

  console.log(`找到 ${goodTokens.length} 个漏掉的好票 (涨幅≥${MIN_RETURN}%)\n`);

  // 分析每个好票
  const preCheckRejected = [];
  const signalNotTriggered = [];
  const unknown = [];

  for (const token of goodTokens) {
    const analysisResults = token.analysis_results || token.analysisResults || {};
    const maxChange = analysisResults.max_change_percent || 0;
    const symbol = token.token_symbol || token.token_address.slice(0, 8);

    // 检查是否有买入信号被拒绝
    const buySignals = signals.filter(s =>
      s.token_address === token.token_address &&
      s.strategy_type === 'buy'
    );

    let category = null;
    let reasons = [];

    if (buySignals.length > 0) {
      const rejectedSignals = buySignals.filter(s => s.executed === false);
      if (rejectedSignals.length > 0) {
        category = 'preCheckRejected';
        const signal = rejectedSignals[0];
        const metadata = signal.metadata || {};
        if (metadata.execution_reason) {
          reasons.push(metadata.execution_reason);
        } else if (metadata.preBuyCheckResult && !metadata.preBuyCheckResult.canBuy) {
          reasons.push(metadata.preBuyCheckResult.reason);
        }
        if (reasons.length === 0) {
          reasons.push('预检查拒绝(原因未知)');
        }
      }
    }

    if (!category) {
      // 尝试获取策略分析数据
      try {
        const strategyAnalysis = await dataLoader.getStrategyAnalysis(token.token_address);
        if (strategyAnalysis && strategyAnalysis.timePoints && strategyAnalysis.timePoints.length > 0) {
          const analysis = analyzeWhyNoSignal(strategyAnalysis);
          category = 'signalNotTriggered';
          reasons = analysis.reasons;
        } else {
          // 尝试同symbol的其他地址
          const sameSymbolTokens = goodTokens.filter(t =>
            t.token_symbol === token.token_symbol &&
            t.token_address !== token.token_address
          );
          let foundAnalysis = false;
          for (const altToken of sameSymbolTokens) {
            const altAnalysis = await dataLoader.getStrategyAnalysis(altToken.token_address);
            if (altAnalysis && altAnalysis.timePoints && altAnalysis.timePoints.length > 0) {
              const analysis = analyzeWhyNoSignal(altAnalysis);
              category = 'signalNotTriggered';
              reasons = analysis.reasons;
              reasons.push('(使用同symbol代币数据)');
              foundAnalysis = true;
              break;
            }
          }
          if (!foundAnalysis) {
            category = 'preCheckRejected'; // 默认归类为预检查拒绝
            reasons.push('预检查拒绝(无详细原因)');
          }
        }
      } catch (e) {
        category = 'unknown';
        reasons.push('无法分析: ' + e.message);
      }
    }

    const item = {
      symbol,
      maxChange,
      reasons
    };

    if (category === 'preCheckRejected') {
      preCheckRejected.push(item);
    } else if (category === 'signalNotTriggered') {
      signalNotTriggered.push(item);
    } else {
      unknown.push(item);
    }
  }

  // 按涨幅排序
  preCheckRejected.sort((a, b) => b.maxChange - a.maxChange);
  signalNotTriggered.sort((a, b) => b.maxChange - a.maxChange);

  // 打印表格
  console.log('═'.repeat(120));
  console.log('【一、预检查拒绝】');
  console.log('═'.repeat(120));
  console.log(`共 ${preCheckRejected.length} 个代币\n`);

  console.log('序号  代币名称              最高涨幅    拒绝原因');
  console.log('─'.repeat(120));
  preCheckRejected.forEach((item, idx) => {
    const reason = item.reasons[0] || '未知';
    const shortReason = reason.length > 50 ? reason.slice(0, 47) + '...' : reason;
    console.log(`${(idx + 1).toString().padStart(3)}  ${item.symbol.padEnd(20)}  +${item.maxChange.toFixed(1).padStart(6)}%    ${shortReason}`);
  });

  console.log('\n');
  console.log('═'.repeat(120));
  console.log('【二、信号未触发】');
  console.log('═'.repeat(120));
  console.log(`共 ${signalNotTriggered.length} 个代币\n`);

  console.log('序号  代币名称              最高涨幅    未触发原因');
  console.log('─'.repeat(120));
  signalNotTriggered.forEach((item, idx) => {
    const reason = item.reasons.join(', ');
    const shortReason = reason.length > 50 ? reason.slice(0, 47) + '...' : reason;
    console.log(`${(idx + 1).toString().padStart(3)}  ${item.symbol.padEnd(20)}  +${item.maxChange.toFixed(1).padStart(6)}%    ${shortReason}`);
  });

  if (unknown.length > 0) {
    console.log('\n');
    console.log('═'.repeat(120));
    console.log('【三、未知原因】');
    console.log('═'.repeat(120));
    console.log(`共 ${unknown.length} 个代币\n`);
    unknown.forEach((item, idx) => {
      console.log(`${(idx + 1).toString().padStart(3)}  ${item.symbol.padEnd(20)}  +${item.maxChange.toFixed(1).padStart(6)}%    ${item.reasons.join(', ')}`);
    });
  }

  console.log('\n');
  console.log('═'.repeat(120));
  console.log('【统计汇总】');
  console.log('═'.repeat(120));
  console.log(`预检查拒绝: ${preCheckRejected.length} 个 (${(preCheckRejected.length / goodTokens.length * 100).toFixed(1)}%)`);
  console.log(`信号未触发: ${signalNotTriggered.length} 个 (${(signalNotTriggered.length / goodTokens.length * 100).toFixed(1)}%)`);
  if (unknown.length > 0) {
    console.log(`未知原因:   ${unknown.length} 个 (${(unknown.length / goodTokens.length * 100).toFixed(1)}%)`);
  }
  console.log(`总计:      ${goodTokens.length} 个`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
