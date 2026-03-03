/**
 * 对比两个实验的 earlyTradesCheckTime
 * 分析 age>1.5 条件的影响
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CATEGORY_MAP = {
  fake_pump: { label: '流水盘', emoji: '🎭' },
  low_quality: { label: '低质量', emoji: '📉' },
  mid_quality: { label: '中质量', emoji: '📊' },
  high_quality: { label: '高质量', emoji: '🚀' }
};

async function analyzeExperiment(experimentId, expName) {
  console.log('='.repeat(60));
  console.log(expName);
  console.log(`实验ID: ${experimentId}`);
  console.log('='.repeat(60));
  console.log('');

  // 获取有人工标注的代币
  const { data: tokens } = await supabase
    .from('experiment_tokens')
    .select('token_address, human_judges')
    .eq('experiment_id', experimentId)
    .not('human_judges', 'is', null);

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

  // 获取买入信号的metadata
  const { data: signals } = await supabase
    .from('strategy_signals')
    .select('token_address, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy');

  // 筛选有早期参与者数据的信号
  const signalsWithData = signals.filter(s =>
    s.metadata && s.metadata.earlyTradesChecked === 1
  );

  console.log(`有早期参与者数据的信号: ${signalsWithData.length}`);
  console.log(`无早期参与者数据的信号: ${signals.length - signalsWithData.length}\n`);

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
      categoryStats[category].push(s.metadata);
    }
  });

  // 统计各类别的时间指标
  console.log('各类别 earlyTradesCheckTime 分布:');
  console.log('');
  console.log('类别 | 样本数 | 平均(秒) | 最小 | 最大 | 中位数');
  console.log('------|--------|----------|------|------|--------');

  const summary = {};

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const data = categoryStats[catKey];
    if (!data || data.length === 0) {
      console.log(`${catLabel.label.padEnd(6)} | 0 | - | - | - | -`);
      continue;
    }

    const times = data
      .map(m => m.earlyTradesCheckTime)
      .filter(t => t != null && t > 0)
      .sort((a, b) => a - b);

    if (times.length === 0) {
      console.log(`${catLabel.label.padEnd(6)} | ${data.length} | 无数据 | - | - | -`);
      continue;
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = times[0];
    const max = times[times.length - 1];
    const median = times[Math.floor(times.length / 2)];

    summary[catKey] = { count: times.length, avg, min, max, median };

    console.log(`${catLabel.label.padEnd(6)} | ${String(times.length).padStart(6)} | ${String(avg.toFixed(1)).padStart(7)} | ${String(min.toFixed(1)).padStart(4)} | ${String(max.toFixed(1)).padStart(4)} | ${String(median.toFixed(1)).padStart(4)}`);
  }

  console.log('');
  console.log('earlyTradesWindow 分布:');
  console.log('');
  console.log('类别 | 样本数 | 平均(秒) | 最小 | 最大 | 中位数');
  console.log('------|--------|----------|------|------|--------');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const data = categoryStats[catKey];
    if (!data || data.length === 0) {
      console.log(`${catLabel.label.padEnd(6)} | 0 | - | - | - | -`);
      continue;
    }

    const windows = data
      .map(m => m.earlyTradesWindow)
      .filter(t => t != null && t > 0)
      .sort((a, b) => a - b);

    if (windows.length === 0) {
      console.log(`${catLabel.label.padEnd(6)} | ${data.length} | 无数据 | - | - | -`);
      continue;
    }

    const avg = windows.reduce((a, b) => a + b, 0) / windows.length;
    const min = windows[0];
    const max = windows[windows.length - 1];
    const median = windows[Math.floor(windows.length / 2)];

    console.log(`${catLabel.label.padEnd(6)} | ${String(windows.length).padStart(6)} | ${String(avg.toFixed(1)).padStart(7)} | ${String(min.toFixed(1)).padStart(4)} | ${String(max.toFixed(1)).padStart(4)} | ${String(median.toFixed(1)).padStart(4)}`);
  }

  console.log('');

  return { categoryStats, signalsWithData, summary };
}

async function main() {
  const exp1 = await analyzeExperiment('ec66badb-023e-40a9-8faf-b11dfe436910', '实验 ec66badb (有age>1.5条件)');
  const summary1 = exp1.summary;

  console.log('\n');
  const exp2 = await analyzeExperiment('e3adb56a-2d36-46b2-9d54-d6a6639e51a5', '实验 e3adb56a (无age条件)');
  const summary2 = exp2.summary;

  // 对比分析
  console.log('='.repeat(60));
  console.log('对比分析: earlyTradesCheckTime');
  console.log('='.repeat(60));
  console.log('');
  console.log('类别 | ec66badb平均 | e3adb56a平均 | 差异(秒) | 差异(%)');
  console.log('------|-------------|-------------|----------|--------');

  for (const [catKey, catLabel] of Object.entries(CATEGORY_MAP)) {
    const s1 = summary1[catKey];
    const s2 = summary2[catKey];

    if (!s1 || !s2) {
      console.log(`${catLabel.label.padEnd(6)} | ${s1 ? s1.avg.toFixed(1) : 'N/A'.padStart(11)} | ${s2 ? s2.avg.toFixed(1) : 'N/A'.padStart(11)} | - | -`);
      continue;
    }

    const diff = s2.avg - s1.avg;
    const diffPct = ((diff / s1.avg) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';

    console.log(`${catLabel.label.padEnd(6)} | ${String(s1.avg.toFixed(1)).padStart(11)} | ${String(s2.avg.toFixed(1)).padStart(11)} | ${String(sign + diff.toFixed(1)).padStart(8)} | ${String(sign + diffPct + '%').padStart(6)}`);
  }

  console.log('');
  console.log('结论:');
  console.log('- 如果 e3adb56a 的 checkTime 显著小于 ec66badb，说明去掉age>1.5条件后');
  console.log('  系统在更早的时间点就获取了早期参与者数据');
  console.log('- 这可能导致早期交易数据较少，从而影响速率指标');
}

main().catch(console.error);
