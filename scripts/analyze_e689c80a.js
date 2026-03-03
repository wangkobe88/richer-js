/**
 * 分析实验 e689c80a-6b70-44f6-8e40-ffd720412780
 * 重点分析低/中质量辨别能力
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

const EXPERIMENT_ID = 'e689c80a-6b70-44f6-8e40-ffd720412780';

// 历史数据参考
const HISTORICAL_MID_LOW_RATIOS = {
  volumePerMin: 4.86,
  countPerMin: 1.81,
  walletsPerMin: 1.98,
  highValuePerMin: 3.26
};

// e3adb56a 数据参考（无age条件）
const E3ADB56A_MID_LOW_RATIOS = {
  volumePerMin: 3.01,
  countPerMin: 2.93,
  walletsPerMin: 2.46,
  highValuePerMin: 2.78
};

function average(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

async function main() {
  console.log('='.repeat(70));
  console.log('实验 e689c80a 早期参与者分析 (有age>1.5条件)');
  console.log('='.repeat(70));
  console.log('');

  // 获取所有代币
  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges, creator_address')
    .eq('experiment_id', EXPERIMENT_ID);

  console.log('DEBUG - error:', error);
  console.log('DEBUG - tokens:', tokens ? tokens.length : 'null');

  if (!tokens || tokens.length === 0) {
    console.log('❌ 没有找到代币数据');
    return;
  }

  // 筛选有人工标注的代币
  const judgedTokens = tokens.filter(t => t.human_judges && t.human_judges !== 'null' && t.human_judges !== '');

  console.log('总代币数: ' + tokens.length);
  console.log('有人工标注的代币: ' + judgedTokens.length);

  // 建立代币到类别的映射
  const tokenCategoryMap = {};
  tokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category) {
      tokenCategoryMap[t.token_address] = judges.category;
    }
  });

  // 统计各类别代币数
  const categoryCount = { fake_pump: 0, low_quality: 0, mid_quality: 0, high_quality: 0 };
  judgedTokens.forEach(t => {
    let judges;
    try {
      judges = typeof t.human_judges === 'string' ? JSON.parse(t.human_judges) : t.human_judges;
    } catch (e) { return; }
    if (judges && judges.category && categoryCount[judges.category] !== undefined) {
      categoryCount[judges.category]++;
    }
  });

  console.log('各类别代币数:');
  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    console.log('  ' + catLabel.emoji + ' ' + catLabel.label + ': ' + categoryCount[catKey]);
  }
  console.log('');

  // 获取买入信号
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXPERIMENT_ID)
    .eq('action', 'buy')
    .order('created_at', { ascending: true });

  if (!signals || signals.length === 0) {
    console.log('❌ 没有找到买入信号数据');
    return;
  }

  console.log('买入信号总数: ' + signals.length);

  // 筛选有早期参与者数据的信号
  const signalsWithData = signals.filter(s =>
    s.metadata && s.metadata.earlyTradesChecked === 1
  );

  console.log('有早期参与者数据的信号: ' + signalsWithData.length);
  console.log('无早期参与者数据的信号: ' + (signals.length - signalsWithData.length));
  console.log('');

  // 按类别分组
  const categoryStats = {
    fake_pump: [],
    low_quality: [],
    mid_quality: [],
    high_quality: []
  };

  signalsWithData.forEach(s => {
    const category = tokenCategoryMap[s.token_address];
    if (category && categoryStats[category]) {
      categoryStats[category].push({
        tokenAddress: s.token_address,
        metadata: s.metadata
      });
    }
  });

  // 统计各类别信号数
  console.log('各类别信号数（有早期参与者数据）:');
  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    console.log('  ' + catLabel.emoji + ' ' + catLabel.label + ': ' + categoryStats[catKey].length);
  }
  console.log('');

  // 计算各类别的平均指标
  console.log('='.repeat(70));
  console.log('各类别指标统计');
  console.log('='.repeat(70));
  console.log('');

  const summary = {};

  for (const catKey of ['low_quality', 'mid_quality']) {
    const catLabel = CATEGORY_MAP[catKey];
    const data = categoryStats[catKey];

    if (data.length === 0) {
      console.log(catLabel.emoji + ' ' + catLabel.label + ': 无数据');
      console.log('');
      continue;
    }

    // 提取指标
    const times = data.map(d => d.metadata.earlyTradesCheckTime).filter(t => t != null);
    const windows = data.map(d => d.metadata.earlyTradesWindow).filter(t => t != null);
    const volumes = data.map(d => d.metadata.earlyTradesVolumePerMin).filter(t => t != null && t > 0);
    const counts = data.map(d => d.metadata.earlyTradesCountPerMin).filter(t => t != null && t > 0);
    const wallets = data.map(d => d.metadata.earlyTradesWalletsPerMin).filter(t => t != null && t > 0);
    const highValues = data.map(d => d.metadata.earlyTradesHighValuePerMin).filter(t => t != null && t > 0);

    summary[catKey] = {
      count: data.length,
      avgCheckTime: average(times),
      avgWindow: average(windows),
      avgVolumePerMin: average(volumes),
      avgCountPerMin: average(counts),
      avgWalletsPerMin: average(wallets),
      avgHighValuePerMin: average(highValues)
    };

    console.log(catLabel.emoji + ' ' + catLabel.label + ' (' + data.length + '个样本):');
    console.log('  earlyTradesCheckTime: 平均 ' + average(times).toFixed(1) + ' 秒');
    console.log('  earlyTradesWindow: 平均 ' + average(windows).toFixed(1) + ' 秒 (' + (average(windows) / 60).toFixed(2) + ' 分钟)');
    console.log('  交易额/分钟: 平均 $' + average(volumes).toFixed(0));
    console.log('  交易次数/分钟: 平均 ' + average(counts).toFixed(1) + ' 次');
    console.log('  钱包数/分钟: 平均 ' + average(wallets).toFixed(1) + ' 个');
    console.log('  高价值交易/分钟: 平均 ' + average(highValues).toFixed(1) + ' 次');
    console.log('');
  }

  // 计算中/低质量倍数
  if (summary.low_quality && summary.mid_quality) {
    const low = summary.low_quality;
    const mid = summary.mid_quality;

    const ratios = {
      volumePerMin: mid.avgVolumePerMin / low.avgVolumePerMin,
      countPerMin: mid.avgCountPerMin / low.avgCountPerMin,
      walletsPerMin: mid.avgWalletsPerMin / low.avgWalletsPerMin,
      highValuePerMin: mid.avgHighValuePerMin / low.avgHighValuePerMin
    };

    console.log('='.repeat(70));
    console.log('中/低质量 倍数关系 (区分力指标)');
    console.log('='.repeat(70));
    console.log('');
    console.log('指标 | 低质量 | 中质量 | 倍数 | vs历史 | vs_e3adb56a');
    console.log('-----|--------|--------|------|--------|-------------');
    console.log('交易额/分钟 | $' + low.avgVolumePerMin.toFixed(0) + ' | $' + mid.avgVolumePerMin.toFixed(0) + ' | ' + ratios.volumePerMin.toFixed(2) + 'x | ' + ((ratios.volumePerMin / HISTORICAL_MID_LOW_RATIOS.volumePerMin - 1) * 100).toFixed(1) + '% | ' + ((ratios.volumePerMin / E3ADB56A_MID_LOW_RATIOS.volumePerMin - 1) * 100).toFixed(1) + '%');
    console.log('交易次数/分钟 | ' + low.avgCountPerMin.toFixed(1) + ' | ' + mid.avgCountPerMin.toFixed(1) + ' | ' + ratios.countPerMin.toFixed(2) + 'x | ' + ((ratios.countPerMin / HISTORICAL_MID_LOW_RATIOS.countPerMin - 1) * 100).toFixed(1) + '% | ' + ((ratios.countPerMin / E3ADB56A_MID_LOW_RATIOS.countPerMin - 1) * 100).toFixed(1) + '%');
    console.log('钱包数/分钟 | ' + low.avgWalletsPerMin.toFixed(1) + ' | ' + mid.avgWalletsPerMin.toFixed(1) + ' | ' + ratios.walletsPerMin.toFixed(2) + 'x | ' + ((ratios.walletsPerMin / HISTORICAL_MID_LOW_RATIOS.walletsPerMin - 1) * 100).toFixed(1) + '% | ' + ((ratios.walletsPerMin / E3ADB56A_MID_LOW_RATIOS.walletsPerMin - 1) * 100).toFixed(1) + '%');
    console.log('高价值/分钟 | ' + low.avgHighValuePerMin.toFixed(1) + ' | ' + mid.avgHighValuePerMin.toFixed(1) + ' | ' + ratios.highValuePerMin.toFixed(2) + 'x | ' + ((ratios.highValuePerMin / HISTORICAL_MID_LOW_RATIOS.highValuePerMin - 1) * 100).toFixed(1) + '% | ' + ((ratios.highValuePerMin / E3ADB56A_MID_LOW_RATIOS.highValuePerMin - 1) * 100).toFixed(1) + '%');
    console.log('');

    // 结论分析
    console.log('='.repeat(70));
    console.log('结论分析');
    console.log('='.repeat(70));
    console.log('');

    const avgWindowMin = (summary.low_quality.avgWindow + summary.mid_quality.avgWindow) / 2 / 60;
    console.log('1. 时间窗口:');
    console.log('   当前实验平均窗口: ' + avgWindowMin.toFixed(2) + ' 分钟');
    console.log('   与历史报告(3分钟)对比: ' + ((avgWindowMin / 3 - 1) * 100).toFixed(1) + '%');
    console.log('');

    console.log('2. 区分力最强的指标:');
    const sortedMetrics = [
      { name: '交易额/分钟', ratio: ratios.volumePerMin },
      { name: '交易次数/分钟', ratio: ratios.countPerMin },
      { name: '钱包数/分钟', ratio: ratios.walletsPerMin },
      { name: '高价值/分钟', ratio: ratios.highValuePerMin }
    ].sort((a, b) => b.ratio - a.ratio);

    sortedMetrics.forEach((m, i) => {
      console.log('   第' + (i + 1) + '名: ' + m.name + ' (' + m.ratio.toFixed(2) + 'x)');
    });
    console.log('');

    console.log('3. 与历史数据对比:');
    console.log('   历史报告使用固定3分钟窗口，中/低质量倍数为:');
    console.log('   - 交易额/分钟: ' + HISTORICAL_MID_LOW_RATIOS.volumePerMin + 'x');
    console.log('   - 交易次数/分钟: ' + HISTORICAL_MID_LOW_RATIOS.countPerMin + 'x');
    console.log('   - 高价值/分钟: ' + HISTORICAL_MID_LOW_RATIOS.highValuePerMin + 'x');
    console.log('');

    console.log('4. 与e3adb56a(无age条件)对比:');
    console.log('   e3adb56a 平均窗口约1分钟，中/低质量倍数为:');
    console.log('   - 交易额/分钟: ' + E3ADB56A_MID_LOW_RATIOS.volumePerMin + 'x');
    console.log('   - 交易次数/分钟: ' + E3ADB56A_MID_LOW_RATIOS.countPerMin + 'x');
    console.log('   - 高价值/分钟: ' + E3ADB56A_MID_LOW_RATIOS.highValuePerMin + 'x');
    console.log('');

    console.log('5. 样本量: 低质量 ' + summary.low_quality.count + ' 个, 中质量 ' + summary.mid_quality.count + ' 个');
  }
}

main().catch(console.error);
