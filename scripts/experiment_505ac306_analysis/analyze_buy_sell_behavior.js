/**
 * 分析早期参与者的买卖行为
 * 买入 vs 卖出模式与代币质量的关系
 */

require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });
const fs = require('fs');
const path = require('path');
const http = require('http');

const DATA_DIR = '/Users/nobody1/Desktop/Codes/richer-js/scripts/experiment_505ac306_analysis';
const EXPERIMENT_ID = '505ac306-97fc-43d6-b027-00b909469b81';
const SOURCE_EXPERIMENT_ID = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

// 加载早期交易数据
const tokenEarlyTrades = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'data/token_early_trades_with_direction.json'),
  'utf8'
));

console.log('='.repeat(80));
console.log('早期参与者买卖行为分析');
console.log('='.repeat(80));

// HTTP请求工具
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', reject);
  });
}

// 分析单个代币的买卖行为
function analyzeTokenBuySell(trades, tokenAddress) {
  const walletBehavior = {}; // { wallet: { buyUSD, sellUSD, txCount } }

  const tokenAddr = tokenAddress.toLowerCase();

  trades.forEach(trade => {
    const wallet = trade.from_address?.toLowerCase();
    if (!wallet) return;

    if (!walletBehavior[wallet]) {
      walletBehavior[wallet] = { buyUSD: 0, sellUSD: 0, txCount: 0 };
    }

    const fromToken = trade.from_token?.toLowerCase() || '';
    const toToken = trade.to_token?.toLowerCase() || '';
    const fromUSD = trade.from_usd || 0;

    // 判断买卖方向：
    // from_token = 目标代币 → 卖出（用代币换BNB）
    // to_token = 目标代币 → 买入（用BNB换取代币）
    const isSelling = fromToken === tokenAddr;
    const isBuying = toToken === tokenAddr;

    if (isBuying && !isSelling) {
      // 买入代币
      walletBehavior[wallet].buyUSD += fromUSD;
    } else if (isSelling && !isBuying) {
      // 卖出代币
      walletBehavior[wallet].sellUSD += fromUSD;
    }

    walletBehavior[wallet].txCount += 1;
  });

  // 统计
  let pureBuyWallets = 0;
  let pureSellWallets = 0;
  let mixedWallets = 0;
  let totalBuyUSD = 0;
  let totalSellUSD = 0;
  let netInflowUSD = 0;
  let totalWallets = 0;

  Object.values(walletBehavior).forEach(w => {
    totalWallets++;
    totalBuyUSD += w.buyUSD;
    totalSellUSD += w.sellUSD;

    if (w.buyUSD > 0 && w.sellUSD === 0) {
      pureBuyWallets++;
    } else if (w.sellUSD > 0 && w.buyUSD === 0) {
      pureSellWallets++;
    } else if (w.buyUSD > 0 && w.sellUSD > 0) {
      mixedWallets++;
    }
  });

  netInflowUSD = totalBuyUSD - totalSellUSD;
  const totalVolume = totalBuyUSD + totalSellUSD;
  const sellRatio = totalVolume > 0 ? totalSellUSD / totalVolume : 0;
  const netInflowRatio = totalVolume > 0 ? netInflowUSD / totalVolume : 0;

  return {
    total_wallets: totalWallets,
    pure_buy_wallets: pureBuyWallets,
    pure_sell_wallets: pureSellWallets,
    mixed_wallets: mixedWallets,
    total_buy_usd: totalBuyUSD,
    total_sell_usd: totalSellUSD,
    net_inflow_usd: netInflowUSD,
    total_volume_usd: totalVolume,
    sell_ratio: sellRatio,
    net_inflow_ratio: netInflowRatio,
    pure_buy_ratio: totalWallets > 0 ? pureBuyWallets / totalWallets : 0,
    pure_sell_ratio: totalWallets > 0 ? pureSellWallets / totalWallets : 0,
    mixed_ratio: totalWallets > 0 ? mixedWallets / totalWallets : 0,
    wallet_behavior: walletBehavior
  };
}

// 点二列相关系数
function pointBiserialCorrelation(binaryValues, continuousValues) {
  const n = binaryValues.length;
  if (n < 3) return null;

  const group1 = [], group0 = [];
  binaryValues.forEach((b, i) => {
    if (b === 1) group1.push(continuousValues[i]);
    else group0.push(continuousValues[i]);
  });

  if (group1.length === 0 || group0.length === 0) return null;

  const n1 = group1.length, n0 = group0.length;
  const mean1 = group1.reduce((a, b) => a + b, 0) / n1;
  const mean0 = group0.reduce((a, b) => a + b, 0) / n0;

  const allValues = continuousValues;
  const mean = allValues.reduce((a, b) => a + b, 0) / n;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  return ((mean1 - mean0) / stdDev) * Math.sqrt((n1 * n0) / (n * n));
}

// 主分析
async function main() {
  // 获取标注数据
  console.log('[获取标注数据...]');
  const tokensRes = await get(`http://localhost:3010/api/experiment/${SOURCE_EXPERIMENT_ID}/tokens?limit=10000`);

  const labelsMap = new Map();
  if (tokensRes.success && tokensRes.data) {
    tokensRes.data.forEach(token => {
      if (token.human_judges && token.human_judges.category) {
        labelsMap.set(token.token_address.toLowerCase(), token.human_judges);
      }
    });
  }
  console.log(`  ✓ ${labelsMap.size} 条标注数据`);

  // 分析每个代币的买卖行为
  const analysisResults = [];

  tokenEarlyTrades.forEach(tokenData => {
    const tokenAddr = tokenData.token_address.toLowerCase();
    const label = labelsMap.get(tokenAddr);

    if (!label || !tokenData.trades || tokenData.trades.length === 0) {
      return;
    }

    const behavior = analyzeTokenBuySell(tokenData.trades, tokenData.token_address);

    analysisResults.push({
      token_symbol: tokenData.token_symbol,
      token_address: tokenAddr,
      quality: label.category,
      ...behavior
    });
  });

  console.log(`  ✓ ${analysisResults.length} 个代币有买卖行为数据`);

  // 按质量分组
  const qualityGroups = {
    high_quality: analysisResults.filter(r => r.quality === 'high_quality'),
    mid_quality: analysisResults.filter(r => r.quality === 'mid_quality'),
    low_quality: analysisResults.filter(r => r.quality === 'low_quality')
  };

  console.log('\n质量分布:');
  console.log(`  高质量: ${qualityGroups.high_quality.length} 个`);
  console.log(`  中质量: ${qualityGroups.mid_quality.length} 个`);
  console.log(`  低质量: ${qualityGroups.low_quality.length} 个`);

  // 计算相关性
  console.log('\n' + '='.repeat(80));
  console.log('买卖行为指标与质量的相关性');
  console.log('='.repeat(80));

  const metrics = [
    { name: '纯买钱包比例', key: 'pure_buy_ratio', desc: '纯买入钱包数 / 总钱包数' },
    { name: '纯卖钱包比例', key: 'pure_sell_ratio', desc: '纯卖出钱包数 / 总钱包数' },
    { name: '混合钱包比例', key: 'mixed_ratio', desc: '混合交易钱包数 / 总钱包数' },
    { name: '卖出金额比例', key: 'sell_ratio', desc: '卖出金额 / 总交易金额' },
    { name: '净流入比例', key: 'net_inflow_ratio', desc: '(买入-卖出) / 总交易金额' },
    { name: '总钱包数', key: 'total_wallets', desc: '参与钱包总数' },
    { name: '总交易金额', key: 'total_volume_usd', desc: '总交易金额(USD)' }
  ];

  const binaryQuality = analysisResults.map(r =>
    (r.quality === 'high_quality' || r.quality === 'mid_quality') ? 1 : 0
  );

  const correlations = {};

  metrics.forEach(metric => {
    const values = analysisResults.map(r => r[metric.key]);
    const pb = pointBiserialCorrelation(binaryQuality, values);

    if (pb !== null) {
      correlations[metric.key] = pb;

      const direction = pb > 0 ? '正相关' : '负相关';
      const strength = Math.abs(pb) > 0.3 ? '强' : Math.abs(pb) > 0.15 ? '中' : '弱';
      const indicator = pb > 0.3 ? '✅ 正向指标' : pb < -0.3 ? '🚩 反向指标' : '⚠️ 弱相关';

      console.log(`\n${metric.name} (${metric.key})`);
      console.log(`  定义: ${metric.desc}`);
      console.log(`  相关性: r=${pb.toFixed(3)} (${strength}${direction}) ${indicator}`);
    }
  });

  // 各质量组的平均值
  console.log('\n' + '='.repeat(80));
  console.log('各质量组的买卖行为特征');
  console.log('='.repeat(80));

  const keyMetrics = ['pure_buy_ratio', 'pure_sell_ratio', 'sell_ratio', 'net_inflow_ratio', 'total_wallets'];

  ['high_quality', 'mid_quality', 'low_quality'].forEach(quality => {
    const tokens = qualityGroups[quality];
    if (tokens.length === 0) return;

    const label = { high_quality: '高', mid_quality: '中', low_quality: '低' }[quality];
    console.log(`\n${label}质量 (${tokens.length}个代币):`);

    keyMetrics.forEach(metricKey => {
      const metric = metrics.find(m => m.key === metricKey);
      const avg = tokens.reduce((sum, t) => sum + t[metricKey], 0) / tokens.length;

      if (metricKey.includes('ratio')) {
        console.log(`  ${metric.name}: ${(avg * 100).toFixed(1)}%`);
      } else {
        console.log(`  ${metric.name}: ${avg.toFixed(1)}`);
      }
    });
  });

  // 保存结果
  const result = {
    metrics: metrics,
    correlations: correlations,
    quality_groups: {
      high_quality: qualityGroups.high_quality.map(r => ({
        symbol: r.token_symbol,
        pure_buy_ratio: r.pure_buy_ratio,
        sell_ratio: r.sell_ratio,
        net_inflow_ratio: r.net_inflow_ratio
      })),
      mid_quality: qualityGroups.mid_quality.map(r => ({
        symbol: r.token_symbol,
        pure_buy_ratio: r.pure_buy_ratio,
        sell_ratio: r.sell_ratio,
        net_inflow_ratio: r.net_inflow_ratio
      })),
      low_quality: qualityGroups.low_quality.map(r => ({
        symbol: r.token_symbol,
        pure_buy_ratio: r.pure_buy_ratio,
        sell_ratio: r.sell_ratio,
        net_inflow_ratio: r.net_inflow_ratio
      }))
    },
    all_results: analysisResults
  };

  fs.writeFileSync(
    path.join(DATA_DIR, 'data/buy_sell_behavior_analysis.json'),
    JSON.stringify(result, null, 2)
  );

  console.log('\n✅ 分析完成! 结果已保存到 data/buy_sell_behavior_analysis.json');
}

main().catch(console.error);
