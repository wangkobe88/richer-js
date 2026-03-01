/**
 * 人工标注代币交易活跃度分析
 * 直接使用 /api/token-early-trades 接口（页面的接口）
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const BASE_URL = 'http://localhost:3010';
const TIME_WINDOW_SECONDS = 90;
const LOW_VALUE_THRESHOLD_USD = 10;
const DELAY_MS = 1000; // 1秒延迟，避免速率限制

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

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

// 使用页面的API接口
async function fetchEarlyTrades(tokenAddress) {
  try {
    const response = await fetch(`${BASE_URL}/api/token-early-trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, chain: 'bsc', limit: 300 })
    });

    if (!response.ok) {
      if (response.status === 429) {
        // 速率限制，等待更长时间
        await sleep(3000);
      }
      return { success: false, trades: [] };
    }

    const result = await response.json();
    await sleep(DELAY_MS); // 正常延迟

    return {
      success: result.success,
      trades: result.success ? (result.data.earlyTrades || []) : []
    };
  } catch (e) {
    return { success: false, trades: [] };
  }
}

function filterTradesInTimeWindow(trades, launchAt) {
  if (!launchAt) return [];
  return trades.filter(t => t.time >= launchAt && t.time <= launchAt + TIME_WINDOW_SECONDS);
}

function analyzeTrades(trades) {
  if (!trades || trades.length === 0) return { totalTrades: 0, totalVolumeUsd: 0, uniqueWallets: 0 };
  const totalVolumeUsd = trades.reduce((s, t) => s + (t.from_usd || t.to_usd || 0), 0);
  const uniqueWallets = new Set(trades.map(t => t.wallet_address)).size;
  return { totalTrades: trades.length, totalVolumeUsd, uniqueWallets };
}

function calculateMedian(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function printStats(label, values) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (valid.length === 0) {
    console.log(`    ${label}: 无数据`);
    return;
  }
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const median = calculateMedian(valid);
  console.log(`    ${label}: 平均${avg.toFixed(1)}, 中位数${median.toFixed(1)}, 范围${Math.min(...valid).toFixed(1)}~${Math.max(...valid).toFixed(1)}`);
}

async function main() {
  console.log('=== 人工标注代币交易活跃度分析 ===\n');
  console.log(`时间窗口: ${TIME_WINDOW_SECONDS}秒 (1.5分钟)`);
  console.log(`低交易额阈值: $${LOW_VALUE_THRESHOLD_USD}`);
  console.log(`每次请求延迟: ${DELAY_MS}ms\n`);

  // 获取标注代币
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
          launchAt: launchAt
        });
      }
    }
  });

  console.log(`找到 ${judgedTokens.length} 个有标注且有时间戳的代币`);
  console.log(`预计用时: ${Math.ceil(judgedTokens.length * DELAY_MS / 60000)}分钟\n`);

  const results = {};
  const apiStats = {};
  Object.keys(CATEGORY_MAP).forEach(key => {
    results[key] = [];
    apiStats[key] = { total: 0, success: 0, failed: 0, noTrades: 0 };
  });

  const categories = ['fake_pump', 'low_quality', 'mid_quality', 'high_quality'];

  for (const category of categories) {
    const tokens = judgedTokens.filter(t => t.category === category);
    if (tokens.length === 0) continue;

    const info = CATEGORY_MAP[category];
    console.log(`=== 分析 ${info.emoji} ${info.label} (${tokens.length}个) ===`);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      apiStats[category].total++;

      const apiResult = await fetchEarlyTrades(token.tokenAddress);

      if (!apiResult.success) {
        apiStats[category].failed++;
        continue;
      }

      apiStats[category].success++;

      const inWindow = filterTradesInTimeWindow(apiResult.trades, token.launchAt);

      if (inWindow.length === 0) {
        apiStats[category].noTrades++;
      }

      const all = analyzeTrades(inWindow);
      const filtered = analyzeTrades(inWindow.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));

      results[category].push({
        tokenAddress: token.tokenAddress,
        allTrades: all.totalTrades,
        filteredTrades: filtered.totalTrades,
        volume: all.totalVolumeUsd,
        uniqueWallets: all.uniqueWallets
      });

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r[${i + 1}/${tokens.length}]`);
      }
    }
    console.log(` 完成`);
  }

  console.log('\n=== API调用统计 ===\n');
  categories.forEach(cat => {
    const info = CATEGORY_MAP[cat];
    const stats = apiStats[cat];
    if (stats.total === 0) return;
    console.log(`${info.emoji} ${info.label}:`);
    console.log(`  总计: ${stats.total}, 成功: ${stats.success}, 失败: ${stats.failed}`);
    console.log(`  成功率: ${(stats.success / stats.total * 100).toFixed(1)}%`);
    console.log(`  0交易: ${stats.noTrades}个 (占成功数据的${(stats.noTrades / stats.success * 100).toFixed(1)}%)`);
    console.log();
  });

  console.log('\n=== 统计结果 (仅统计API成功且有数据) ===\n');

  categories.forEach(cat => {
    const info = CATEGORY_MAP[cat];
    const data = results[cat];
    if (data.length === 0) return;
    console.log(`--- ${info.emoji} ${info.label} (${data.length}个) ---`);
    printStats('全部交易次数', data.map(r => r.allTrades));
    printStats('过滤后交易次数', data.map(r => r.filteredTrades));
    printStats('交易金额(USD)', data.map(r => r.volume));
    printStats('独立钱包数', data.map(r => r.uniqueWallets));
    console.log();
  });

  const summary = {};
  categories.forEach(cat => {
    const data = results[cat];
    if (data.length === 0) return;
    summary[cat] = {
      label: CATEGORY_MAP[cat].label,
      avgAllTrades: data.reduce((s, r) => s + r.allTrades, 0) / data.length,
      avgFilteredTrades: data.reduce((s, r) => s + r.filteredTrades, 0) / data.length,
      avgVolume: data.reduce((s, r) => s + r.volume, 0) / data.length,
      count: data.length
    };
  });

  console.log('=== 差异对比 ===\n');
  console.log('\n平均交易次数:');
  categories.forEach(cat => {
    if (summary[cat]) {
      console.log(`  ${summary[cat].label.padEnd(8)}: 全部${summary[cat].avgAllTrades.toFixed(1)}次, 过滤后${summary[cat].avgFilteredTrades.toFixed(1)}次`);
    }
  });

  console.log('\n平均交易金额:');
  categories.forEach(cat => {
    if (summary[cat]) {
      console.log(`  ${summary[cat].label.padEnd(8)}: $${summary[cat].avgVolume.toFixed(0)}`);
    }
  });

  const base = summary.fake_pump;
  if (base) {
    console.log('\n=== 倍数关系 (以流水盘为基准) ===\n');
    categories.forEach(cat => {
      if (cat === 'fake_pump' || !summary[cat]) return;
      const s = summary[cat];
      const tradesRatio = s.avgFilteredTrades / base.avgFilteredTrades;
      const volumeRatio = s.avgVolume / base.avgVolume;
      console.log(`${s.label} vs 流水盘:`);
      console.log(`  交易次数: ${tradesRatio.toFixed(2)}x`);
      console.log(`  交易金额: ${volumeRatio.toFixed(2)}x`);
    });
  }

  console.log('\n分析完成！');
}

main().catch(console.error);
