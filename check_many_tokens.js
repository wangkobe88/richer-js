const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TIME_WINDOW_SECONDS = 90;
const CATEGORY_MAP = {
  fake_pump: '🎭流水盘',
  low_quality: '📉低质量',
  mid_quality: '📊中质量',
  high_quality: '🚀高质量'
};

async function getLaunchAt(rawApiData) {
  if (!rawApiData) return null;
  try {
    const parsed = typeof rawApiData === 'string' ? JSON.parse(rawApiData) : rawApiData;
    return parsed.token?.launch_at || parsed.launch_at || null;
  } catch (e) {
    return null;
  }
}

async function check() {
  const { data } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data, human_judges')
    .not('human_judges', 'is', null)
    .limit(50);

  if (!data || data.length === 0) {
    console.log('没有找到数据');
    return;
  }

  const categoryStats = {};

  for (const token of data) {
    const launchAt = await getLaunchAt(token.raw_api_data);
    if (!launchAt) continue;

    let judges;
    try {
      judges = typeof token.human_judges === 'string' ? JSON.parse(token.human_judges) : token.human_judges;
    } catch (e) {
      judges = {};
    }

    const category = judges.category || 'unknown';

    if (!categoryStats[category]) {
      categoryStats[category] = { total: 0, zeroTrades: 0, hasTrades: 0, tradeCounts: [] };
    }

    categoryStats[category].total++;

    // 调用API
    try {
      const response = await fetch('http://localhost:3010/api/token-early-trades', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tokenAddress: token.token_address, chain: 'bsc', limit: 300})
      });

      const result = await response.json();
      if (result.success && result.data.earlyTrades) {
        const trades = result.data.earlyTrades;
        const inWindow = trades.filter(t => t.time >= launchAt && t.time <= launchAt + TIME_WINDOW_SECONDS);

        categoryStats[category].tradeCounts.push(inWindow.length);

        if (inWindow.length === 0) {
          categoryStats[category].zeroTrades++;
        } else {
          categoryStats[category].hasTrades++;
        }
      }
    } catch (e) {
      // API调用失败，跳过
    }
  }

  console.log('=== 1.5分钟内交易分布统计 ===\n');

  Object.entries(categoryStats).forEach(([cat, stats]) => {
    const label = CATEGORY_MAP[cat] || cat;
    const zeroRatio = (stats.zeroTrades / stats.total * 100).toFixed(1);
    const sorted = [...stats.tradeCounts].sort((a, b) => a - b);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

    console.log(`${label} (${stats.total}个):`);
    console.log(`  0交易: ${stats.zeroTrades}个 (${zeroRatio}%)`);
    console.log(`  有交易: ${stats.hasTrades}个`);
    console.log(`  中位数: ${median}笔`);
    console.log();
  });
}
check().catch(console.error);
