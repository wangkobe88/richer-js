const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const TIME_WINDOW_SECONDS = 90;

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
  // 获取几个有标注的代币
  const { data } = await supabase
    .from('experiment_tokens')
    .select('token_address, raw_api_data, human_judges')
    .not('human_judges', 'is', null)
    .limit(5);

  if (!data || data.length === 0) {
    console.log('没有找到数据');
    return;
  }

  console.log('检查前5个标注代币的交易情况:\n');

  for (let i = 0; i < data.length; i++) {
    const token = data[i];
    const launchAt = await getLaunchAt(token.raw_api_data);

    let judges;
    try {
      judges = typeof token.human_judges === 'string' ? JSON.parse(token.human_judges) : token.human_judges;
    } catch (e) {
      judges = {};
    }

    const category = judges.category || 'unknown';
    const categoryLabels = {
      fake_pump: '🎭流水盘',
      low_quality: '📉低质量',
      mid_quality: '📊中质量',
      high_quality: '🚀高质量'
    };

    console.log(`[${i + 1}] ${token.token_address.slice(0, 10)}... ${categoryLabels[category] || category}`);
    console.log(`    launch_at: ${launchAt} (${new Date(launchAt * 1000).toISOString()})`);

    // 调用API获取交易
    const response = await fetch('http://localhost:3010/api/token-early-trades', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tokenAddress: token.token_address, chain: 'bsc', limit: 300})
    });

    const result = await response.json();
    if (result.success && result.data.earlyTrades) {
      const trades = result.data.earlyTrades;
      const debugInfo = result.data.debug;

      // 过滤1.5分钟内的交易
      const inWindow = trades.filter(t => t.time >= launchAt && t.time <= launchAt + TIME_WINDOW_SECONDS);

      console.log(`    API返回总交易: ${trades.length}笔`);
      console.log(`    1.5分钟内交易: ${inWindow.length}笔`);

      if (inWindow.length > 0) {
        const first = inWindow[0];
        const last = inWindow[inWindow.length - 1];
        console.log(`    时间范围: +${(first.time - launchAt).toFixed(0)}s ~ +${(last.time - launchAt).toFixed(0)}s`);
      } else if (trades.length > 0) {
        const first = trades[0];
        const last = trades[trades.length - 1];
        console.log(`    所有交易时间范围: +${(first.time - launchAt).toFixed(0)}s ~ +${(last.time - launchAt).toFixed(0)}s`);
        if (first.time - launchAt > TIME_WINDOW_SECONDS) {
          console.log(`    ⚠️ 首笔交易超过${TIME_WINDOW_SECONDS}秒！`);
        }
      } else {
        console.log(`    ⚠️ API没有返回任何交易数据`);
      }
    } else {
      console.log(`    API调用失败`);
    }
    console.log();
  }
}
check().catch(console.error);
