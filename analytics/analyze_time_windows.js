/**
 * 分析不同时间窗口的交易活跃度
 * 获取3分钟数据，然后分别过滤分析1分钟、1.5分钟、2分钟、3分钟
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { global: { headers: { 'Prefer': 'timeout=20s' } } }
);

const BASE_URL = 'http://localhost:3010';
const LOW_VALUE_THRESHOLD_USD = 10;
const HIGH_VALUE_THRESHOLD_USD = 100; // 高价值交易阈值
const DELAY_MS = 1000;

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

const TIME_WINDOWS = [60, 90, 120, 180]; // 1分钟、1.5分钟、2分钟、3分钟

function getLaunchAtFromRawApi(rawApiData) {
  if (!rawApiData) return null;
  try {
    const parsed = typeof rawApiData === 'string' ? JSON.parse(rawApiData) : rawApiData;
    return parsed.token?.launch_at || parsed.launch_at || null;
  } catch (e) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEarlyTrades(tokenAddress) {
  try {
    const response = await fetch(`${BASE_URL}/api/token-early-trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, chain: 'bsc', limit: 300, timeWindowMinutes: 3 })
    });

    if (!response.ok) {
      if (response.status === 429) {
        await sleep(3000);
      }
      return { success: false, trades: [] };
    }

    const result = await response.json();
    await sleep(DELAY_MS);

    return {
      success: result.success,
      trades: result.success ? (result.data.earlyTrades || []) : []
    };
  } catch (e) {
    return { success: false, trades: [] };
  }
}

function filterTradesInWindow(trades, launchAt, windowSeconds) {
  if (!launchAt || !trades || trades.length === 0) return [];
  return trades.filter(t => t.time >= launchAt && t.time <= launchAt + windowSeconds);
}

function analyzeTrades(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      totalVolumeUsd: 0,
      uniqueWallets: 0,
      highValueTrades: 0  // 高价值交易次数（>$100）
    };
  }

  const totalVolumeUsd = trades.reduce((s, t) => s + (t.from_usd || t.to_usd || 0), 0);
  const uniqueWallets = new Set();
  let highValueTrades = 0;

  trades.forEach(t => {
    if (t.from_address) uniqueWallets.add(t.from_address.toLowerCase());
    if (t.to_address) uniqueWallets.add(t.to_address.toLowerCase());
    const value = t.from_usd || t.to_usd || 0;
    if (value >= HIGH_VALUE_THRESHOLD_USD) highValueTrades++;
  });

  return {
    totalTrades: trades.length,
    totalVolumeUsd,
    uniqueWallets: uniqueWallets.size,
    highValueTrades
  };
}

async function main() {
  console.log('获取代币数据...');

  const { data, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data, human_judges')
    .not('human_judges', 'is', null)
    .limit(5000);

  if (error) throw error;

  const judgedTokens = [];
  data.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }

    if (judges && judges.category) {
      const launchAt = getLaunchAtFromRawApi(t.raw_api_data);
      if (launchAt) {
        judgedTokens.push({
          tokenAddress: t.token_address,
          category: judges.category,
          note: judges.note || '',
          launchAt: launchAt
        });
      }
    }
  });

  console.log(`找到 ${judgedTokens.length} 个代币`);
  console.log('开始获取交易数据（3分钟窗口）...\n');

  // 存储所有代币的原始数据（3分钟窗口）
  const tokensData = [];

  for (let i = 0; i < judgedTokens.length; i++) {
    const token = judgedTokens[i];
    process.stdout.write(`\r[${i + 1}/${judgedTokens.length}] ${token.tokenAddress.slice(0, 10)}...`);

    const apiResult = await fetchEarlyTrades(token.tokenAddress);

    if (apiResult.success && apiResult.trades.length > 0) {
      tokensData.push({
        ...token,
        allTrades: apiResult.trades
      });
    }
  }

  console.log(`\n\n获取到 ${tokensData.length} 个有交易的代币`);

  // 对每个时间窗口进行分析
  for (const windowSeconds of TIME_WINDOWS) {
    const windowMinutes = (windowSeconds / 60).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`分析 ${windowMinutes} 分钟时间窗口`);
    console.log(`${'='.repeat(60)}\n`);

    const stats = {
      fake_pump: [],
      low_quality: [],
      mid_quality: [],
      high_quality: []
    };

    for (const token of tokensData) {
      const inWindow = filterTradesInWindow(token.allTrades, token.launchAt, windowSeconds);
      const all = analyzeTrades(inWindow);
      const filtered = analyzeTrades(inWindow.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));

      if (stats[token.category]) {
        stats[token.category].push({
          allTrades: all.totalTrades,
          filteredTrades: filtered.totalTrades,
          volume: filtered.totalVolumeUsd,
          uniqueWallets: filtered.uniqueWallets,
          highValueTrades: filtered.highValueTrades
        });
      }
    }

    // 输出统计结果
    for (const [catKey, catLabel] of Object.entries({
      fake_pump: '🎭 流水盘',
      low_quality: '📉 低质量',
      mid_quality: '📊 中质量',
      high_quality: '🚀 高质量'
    })) {
      const data = stats[catKey];
      if (!data || data.length === 0) continue;

      const avgAll = data.reduce((s, x) => s + x.allTrades, 0) / data.length;
      const avgFiltered = data.reduce((s, x) => s + x.filteredTrades, 0) / data.length;
      const avgVolume = data.reduce((s, x) => s + x.volume, 0) / data.length;
      const avgWallets = data.reduce((s, x) => s + x.uniqueWallets, 0) / data.length;
      const avgHighValue = data.reduce((s, x) => s + x.highValueTrades, 0) / data.length;

      console.log(`${catLabel} (${data.length}个代币):`);
      console.log(`  全部交易次数: 平均 ${avgAll.toFixed(1)} 次`);
      console.log(`  过滤后交易次数(>$10): 平均 ${avgFiltered.toFixed(1)} 次`);
      console.log(`  高价值交易次数(>$100): 平均 ${avgHighValue.toFixed(1)} 次`);
      console.log(`  交易总额: 平均 $${avgVolume.toFixed(2)}`);
      console.log(`  参与钱包数: 平均 ${avgWallets.toFixed(1)} 个`);
      console.log('');
    }
  }

  // 生成对比表格
  console.log(`\n${'='.repeat(60)}`);
  console.log('时间窗口对比（过滤后交易次数，>$10）');
  console.log(`${'='.repeat(60)}\n`);

  const comparisonData = {};

  for (const windowSeconds of TIME_WINDOWS) {
    const windowMinutes = (windowSeconds / 60).toFixed(1);
    comparisonData[windowMinutes] = {};

    for (const catKey of ['fake_pump', 'low_quality', 'mid_quality', 'high_quality']) {
      const data = [];

      for (const token of tokensData) {
        if (token.category !== catKey) continue;
        const inWindow = filterTradesInWindow(token.allTrades, token.launchAt, windowSeconds);
        const filtered = analyzeTrades(inWindow.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));
        data.push(filtered);
      }

      const avgFiltered = data.reduce((s, x) => s + x.filteredTrades, 0) / data.length;
      const avgVolume = data.reduce((s, x) => s + x.volume, 0) / data.length;
      const avgWallets = data.reduce((s, x) => s + x.uniqueWallets, 0) / data.length;
      const avgHighValue = data.reduce((s, x) => s + x.highValueTrades, 0) / data.length;

      comparisonData[windowMinutes][catKey] = {
        trades: avgFiltered.toFixed(1),
        volume: avgVolume.toFixed(0),
        wallets: avgWallets.toFixed(1),
        highValue: avgHighValue.toFixed(1)
      };
    }
  }

  // 输出对比表格
  console.log('时间窗口 | 流水盘 | 低质量 | 中质量 | 高质量');
  console.log('---------|--------|--------|--------|--------');

  for (const windowMinutes of Object.keys(comparisonData)) {
    const fp = comparisonData[windowMinutes].fake_pump.trades;
    const lq = comparisonData[windowMinutes].low_quality.trades;
    const mq = comparisonData[windowMinutes].mid_quality.trades;
    const hq = comparisonData[windowMinutes].high_quality.trades;
    console.log(`${windowMinutes}分钟 | ${fp}次 | ${lq}次 | ${mq}次 | ${hq}次`);
  }

  console.log('\n倍数关系（以流水盘为基准）:');
  console.log('时间窗口 | 低质量 | 中质量 | 高质量');
  console.log('---------|--------|--------|--------');

  for (const windowMinutes of Object.keys(comparisonData)) {
    const fp = parseFloat(comparisonData[windowMinutes].fake_pump.trades);
    const lq = (parseFloat(comparisonData[windowMinutes].low_quality.trades) / fp).toFixed(2);
    const mq = (parseFloat(comparisonData[windowMinutes].mid_quality.trades) / fp).toFixed(2);
    const hq = (parseFloat(comparisonData[windowMinutes].high_quality.trades) / fp).toFixed(2);
    console.log(`${windowMinutes}分钟 | ${lq}x | ${mq}x | ${hq}x`);
  }

  console.log('\n参与钱包数:');
  console.log('时间窗口 | 流水盘 | 低质量 | 中质量 | 高质量');
  console.log('---------|--------|--------|--------|--------');

  for (const windowMinutes of Object.keys(comparisonData)) {
    const fp = comparisonData[windowMinutes].fake_pump.wallets;
    const lq = comparisonData[windowMinutes].low_quality.wallets;
    const mq = comparisonData[windowMinutes].mid_quality.wallets;
    const hq = comparisonData[windowMinutes].high_quality.wallets;
    console.log(`${windowMinutes}分钟 | ${fp} | ${lq} | ${mq} | ${hq}`);
  }

  console.log('\n高价值交易次数(>$100):');
  console.log('时间窗口 | 流水盘 | 低质量 | 中质量 | 高质量');
  console.log('---------|--------|--------|--------|--------');

  for (const windowMinutes of Object.keys(comparisonData)) {
    const fp = comparisonData[windowMinutes].fake_pump.highValue;
    const lq = comparisonData[windowMinutes].low_quality.highValue;
    const mq = comparisonData[windowMinutes].mid_quality.highValue;
    const hq = comparisonData[windowMinutes].high_quality.highValue;
    console.log(`${windowMinutes}分钟 | ${fp}次 | ${lq}次 | ${mq}次 | ${hq}次`);
  }

  console.log('\n交易总额(USD):');
  console.log('时间窗口 | 流水盘 | 低质量 | 中质量 | 高质量');
  console.log('---------|--------|--------|--------|--------');

  for (const windowMinutes of Object.keys(comparisonData)) {
    const fp = comparisonData[windowMinutes].fake_pump.volume;
    const lq = comparisonData[windowMinutes].low_quality.volume;
    const mq = comparisonData[windowMinutes].mid_quality.volume;
    const hq = comparisonData[windowMinutes].high_quality.volume;
    console.log(`${windowMinutes}分钟 | $${fp} | $${lq} | $${mq} | $${hq}`);
  }
}

main().catch(console.error);
