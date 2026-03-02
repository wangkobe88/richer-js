/**
 * 生成交易活跃度分析CSV文件
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const BASE_URL = 'http://localhost:3010';
const LOW_VALUE_THRESHOLD_USD = 10;
const DELAY_MS = 1000;

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

async function fetchEarlyTrades(tokenAddress) {
  try {
    const response = await fetch(`${BASE_URL}/api/token-early-trades`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenAddress, chain: 'bsc', limit: 300, timeWindowMinutes: 1.5 })
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

function analyzeTrades(trades) {
  if (!trades || trades.length === 0) return { totalTrades: 0, totalVolumeUsd: 0, uniqueWallets: 0 };
  const totalVolumeUsd = trades.reduce((s, t) => s + (t.from_usd || t.to_usd || 0), 0);
  const uniqueWallets = new Set(trades.map(t => t.wallet_address)).size;
  return { totalTrades: trades.length, totalVolumeUsd, uniqueWallets };
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
  console.log('开始获取交易数据...\n');

  const csvRows = [];
  csvRows.push('token_address,category,category_label,launch_at,all_trades,filtered_trades,volume_usd,unique_wallets,first_trade_time,last_trade_time,note');

  for (let i = 0; i < judgedTokens.length; i++) {
    const token = judgedTokens[i];
    process.stdout.write(`\r[${i + 1}/${judgedTokens.length}] ${token.tokenAddress.slice(0, 10)}...`);

    const apiResult = await fetchEarlyTrades(token.tokenAddress);

    if (!apiResult.success) {
      csvRows.push(`${token.tokenAddress},${token.category},"${CATEGORY_MAP[token.category]?.label || token.category}",${token.launchAt},0,0,0,0,,,`);
      continue;
    }

    // API 已经按时间窗口返回了数据，直接使用
    const trades = apiResult.trades;
    const all = analyzeTrades(trades);
    const filtered = analyzeTrades(trades.filter(t => (t.from_usd || t.to_usd || 0) >= LOW_VALUE_THRESHOLD_USD));

    const firstTime = trades.length > 0 ? (trades[0].time - token.launchAt) : '';
    const lastTime = trades.length > 0 ? (trades[trades.length - 1].time - token.launchAt) : '';

    const noteEscaped = token.note.replace(/"/g, '""');
    csvRows.push(`${token.tokenAddress},${token.category},"${CATEGORY_MAP[token.category]?.label || token.category}",${token.launchAt},${all.totalTrades},${filtered.totalTrades},${filtered.totalVolumeUsd.toFixed(2)},${filtered.uniqueWallets},${firstTime},${lastTime},"${noteEscaped}"`);
  }

  console.log('\n\n写入CSV文件...');

  const fs = require('fs');
  const csvContent = csvRows.join('\n');
  fs.writeFileSync('trading_activity_analysis.csv', csvContent, 'utf8');

  console.log('CSV文件已生成: trading_activity_analysis.csv');
}

main().catch(console.error);
