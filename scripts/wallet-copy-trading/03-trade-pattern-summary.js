/**
 * Step 3: 汇总分析钱包交易模式 + 对比结论
 * 读取 Step 1 和 Step 2 的数据，输出可读报告
 *
 * 用法: node scripts/wallet-copy-trading/03-trade-pattern-summary.js
 */

const fs = require('fs');
const path = require('path');
const { WALLET_ADDRESS, DATA_DIR } = require('./config');

const WALLET_TRADES_FILE = path.join(DATA_DIR, 'wallet-trades.json');
const COMPARISON_FILE = path.join(DATA_DIR, 'comparison-report.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'analysis-summary.md');

// ---------- 工具函数 ----------

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return 'N/A';
  if (seconds < 60) return `${seconds.toFixed(0)}秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}分钟`;
  return `${(seconds / 3600).toFixed(1)}小时`;
}

function formatTime(ts) {
  if (!ts) return 'N/A';
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ---------- 分析模块 ----------

function analyzeWalletProfile(walletData) {
  const pairs = walletData.pairs || [];
  const trades = walletData.trades || [];
  const buys = trades.filter(t => t.action === 'buy');
  const sells = trades.filter(t => t.action === 'sell');

  const closed = pairs.filter(p => p.status === 'closed');
  const wins = closed.filter(p => p.roi_percent > 0);
  const losses = closed.filter(p => p.roi_percent <= 0);

  // 持仓时长
  const durations = closed.map(p => p.hold_duration_seconds).filter(d => d != null);
  const winDurations = wins.map(p => p.hold_duration_seconds).filter(d => d != null);
  const lossDurations = losses.map(p => p.hold_duration_seconds).filter(d => d != null);

  // 买入金额
  const amounts = buys.map(b => b.amount_usd).filter(a => a > 0);

  // ROI
  const rois = closed.map(p => p.roi_percent).filter(r => r != null);
  const winRois = wins.map(p => p.roi_percent).filter(r => r != null);
  const lossRois = losses.map(p => p.roi_percent).filter(r => r != null);

  // 时间分布
  const buyTimes = buys.map(b => b.timestamp).filter(t => t > 0);
  const dayBuckets = {};
  for (const ts of buyTimes) {
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    dayBuckets[day] = (dayBuckets[day] || 0) + 1;
  }
  const dailyCounts = Object.values(dayBuckets);
  const activeDays = dailyCounts.length;

  return {
    totalBuys: buys.length,
    totalSells: sells.length,
    totalPairs: pairs.length,
    closedCount: closed.length,
    holdingCount: pairs.filter(p => p.status === 'holding').length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length * 100) : 0,

    // ROI
    roiMedian: median(rois),
    roiP25: percentile(rois, 25),
    roiP75: percentile(rois, 75),
    avgWinRoi: winRois.length > 0 ? winRois.reduce((s, r) => s + r, 0) / winRois.length : 0,
    avgLossRoi: lossRois.length > 0 ? lossRois.reduce((s, r) => s + r, 0) / lossRois.length : 0,
    profitFactor: (() => {
      const totalWin = winRois.reduce((s, r) => s + r, 0);
      const totalLoss = Math.abs(lossRois.reduce((s, r) => s + r, 0));
      return totalLoss > 0 ? totalWin / totalLoss : Infinity;
    })(),

    // 持仓
    holdMedian: median(durations),
    holdP25: percentile(durations, 25),
    holdP75: percentile(durations, 75),
    winHoldMedian: median(winDurations),
    lossHoldMedian: median(lossDurations),

    // 金额
    buyAmountMedian: median(amounts),
    buyAmountAvg: amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) / amounts.length : 0,
    buyAmountMin: amounts.length > 0 ? Math.min(...amounts) : 0,
    buyAmountMax: amounts.length > 0 ? Math.max(...amounts) : 0,
    cv: (() => {
      if (amounts.length < 2) return 0;
      const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const variance = amounts.reduce((s, a) => s + Math.pow(a - avg, 2), 0) / amounts.length;
      return avg > 0 ? Math.sqrt(variance) / avg : 0;
    })(),

    // 频率
    activeDays,
    avgTradesPerDay: activeDays > 0 ? buys.length / activeDays : 0,
    firstTradeTime: buyTimes.length > 0 ? formatTime(Math.min(...buyTimes)) : 'N/A',
    lastTradeTime: buyTimes.length > 0 ? formatTime(Math.max(...buyTimes)) : 'N/A',

    // 分批操作
    multiBuyPairs: pairs.filter(p => p.buy_count > 1).length,
    multiSellPairs: closed.filter(p => p.sell_count > 1).length,
  };
}

function analyzeComparison(comparisonReport) {
  if (!comparisonReport) return null;

  const s = comparisonReport.summary;
  const overlaps = comparisonReport.overlaps || [];

  // 买入时间差
  const timeDiffs = overlaps.filter(o => o.buy_time_diff_seconds != null).map(o => o.buy_time_diff_seconds);
  const walletFirst = timeDiffs.filter(d => d > 0).length;
  const expFirst = timeDiffs.filter(d => d < 0).length;
  const sameTime = timeDiffs.filter(d => Math.abs(d) < 5).length;

  // 重叠代币盈亏
  const overlapWalletRois = overlaps.map(o => o.wallet?.roi_percent).filter(r => r != null);
  const overlapExpRois = overlaps.map(o => o.experiment?.roi_percent).filter(r => r != null);

  // 漏买原因排名
  const walletOnly = comparisonReport.walletOnlyAnalysis || [];
  const profitableMissed = walletOnly.filter(w => w.wallet_roi && w.wallet_roi > 0);
  const missedReasons = {};
  for (const w of walletOnly) {
    missedReasons[w.experiment_status] = (missedReasons[w.experiment_status] || 0) + 1;
  }
  const profitableMissedReasons = {};
  for (const w of profitableMissed) {
    profitableMissedReasons[w.experiment_status] = (profitableMissedReasons[w.experiment_status] || 0) + 1;
  }

  return {
    overlapCount: s.overlapCount,
    overlapRate: s.walletTotalPairs > 0 ? (s.overlapCount / s.walletTotalPairs * 100).toFixed(1) : '0',
    timeDiffMedian: median(timeDiffs),
    walletFirstCount: walletFirst,
    expFirstCount: expFirst,
    sameTimeCount: sameTime,
    overlapAvgWalletRoi: overlapWalletRois.length > 0 ? overlapWalletRois.reduce((s, r) => s + r, 0) / overlapWalletRois.length : null,
    overlapAvgExpRoi: overlapExpRois.length > 0 ? overlapExpRois.reduce((s, r) => s + r, 0) / overlapExpRois.length : null,
    missedReasons: Object.entries(missedReasons).sort((a, b) => b[1] - a[1]),
    profitableMissedReasons: Object.entries(profitableMissedReasons).sort((a, b) => b[1] - a[1]),
    profitableMissedCount: profitableMissed.length,
    walletOnlyTotal: s.walletOnlyCount,
  };
}

function generateReport(walletData, profile, comparison) {
  let md = '';

  md += `# 钱包交易模式分析报告\n\n`;
  md += `钱包: \`${WALLET_ADDRESS}\`\n`;
  md += `分析时间: ${new Date().toISOString()}\n\n`;

  // A. 钱包画像
  md += `## A. 钱包画像\n\n`;
  md += `| 指标 | 值 |\n|---|---|\n`;
  md += `| 总买入 | ${profile.totalBuys} 笔 |\n`;
  md += `| 总交易对 | ${profile.totalPairs} (已平仓 ${profile.closedCount}, 持仓中 ${profile.holdingCount}) |\n`;
  md += `| 胜率 | ${profile.winRate.toFixed(1)}% (${profile.winCount}胜 / ${profile.lossCount}负) |\n`;
  md += `| 盈亏比 | ${profile.profitFactor.toFixed(2)} |\n`;
  md += `| 平均盈利 | +${profile.avgWinRoi.toFixed(1)}% |\n`;
  md += `| 平均亏损 | ${profile.avgLossRoi.toFixed(1)}% |\n\n`;

  md += `### 买入金额\n\n`;
  md += `- 中位数: $${profile.buyAmountMedian.toFixed(2)}\n`;
  md += `- 平均值: $${profile.buyAmountAvg.toFixed(2)}\n`;
  md += `- 范围: $${profile.buyAmountMin.toFixed(2)} ~ $${profile.buyAmountMax.toFixed(2)}\n`;
  md += `- 变异系数(CV): ${profile.cv.toFixed(2)} ${profile.cv < 0.3 ? '(固定金额策略)' : '(可变金额)'}\n\n`;

  md += `### 持仓时长\n\n`;
  md += `- 中位数: ${formatDuration(profile.holdMedian)}\n`;
  md += `- P25: ${formatDuration(profile.holdP25)}\n`;
  md += `- P75: ${formatDuration(profile.holdP75)}\n`;
  md += `- 盈利持仓中位数: ${formatDuration(profile.winHoldMedian)}\n`;
  md += `- 亏损持仓中位数: ${formatDuration(profile.lossHoldMedian)}\n\n`;

  md += `### 交易频率\n\n`;
  md += `- 活跃天数: ${profile.activeDays} 天\n`;
  md += `- 日均交易: ${profile.avgTradesPerDay.toFixed(1)} 笔\n`;
  md += `- 时间跨度: ${profile.firstTradeTime} ~ ${profile.lastTradeTime}\n`;
  md += `- 分批买入: ${profile.multiBuyPairs}/${profile.totalPairs} 笔\n`;
  md += `- 分批卖出: ${profile.multiSellPairs}/${profile.closedCount} 笔\n\n`;

  md += `### ROI 分布\n\n`;
  md += `- 中位数: ${profile.roiMedian.toFixed(1)}%\n`;
  md += `- P25: ${profile.roiP25.toFixed(1)}%\n`;
  md += `- P75: ${profile.roiP75.toFixed(1)}%\n\n`;

  // B. 买卖策略特征
  md += `## B. 买卖策略特征\n\n`;

  const closed = (walletData.pairs || []).filter(p => p.status === 'closed');
  const wins = closed.filter(p => p.roi_percent > 0);
  const losses = closed.filter(p => p.roi_percent <= 0);

  // 止盈特征
  if (wins.length > 0) {
    const winRois = wins.map(p => p.roi_percent).sort((a, b) => a - b);
    md += `### 止盈特征 (盈利交易)\n\n`;
    md += `- 盈利范围: ${Math.min(...winRois).toFixed(1)}% ~ ${Math.max(...winRois).toFixed(1)}%\n`;
    md += `- 中位数止盈: ${median(winRois).toFixed(1)}%\n`;
    md += `- 快速止盈 (<60s): ${wins.filter(w => w.hold_duration_seconds && w.hold_duration_seconds < 60).length}/${wins.length}\n`;
    md += `- 正常止盈 (60-300s): ${wins.filter(w => w.hold_duration_seconds && w.hold_duration_seconds >= 60 && w.hold_duration_seconds < 300).length}/${wins.length}\n`;
    md += `- 慢止盈 (>300s): ${wins.filter(w => w.hold_duration_seconds && w.hold_duration_seconds >= 300).length}/${wins.length}\n\n`;
  }

  // 止损特征
  if (losses.length > 0) {
    const lossRois = losses.map(p => p.roi_percent).sort((a, b) => a - b);
    md += `### 止损特征 (亏损交易)\n\n`;
    md += `- 亏损范围: ${Math.min(...lossRois).toFixed(1)}% ~ ${Math.max(...lossRois).toFixed(1)}%\n`;
    md += `- 中位数止损: ${median(lossRois).toFixed(1)}%\n`;
    md += `- 快速止损 (<30s): ${losses.filter(l => l.hold_duration_seconds && l.hold_duration_seconds < 30).length}/${losses.length}\n`;
    md += `- 短持止损 (30-60s): ${losses.filter(l => l.hold_duration_seconds && l.hold_duration_seconds >= 30 && l.hold_duration_seconds < 60).length}/${losses.length}\n`;
    md += `- 中持止损 (60-180s): ${losses.filter(l => l.hold_duration_seconds && l.hold_duration_seconds >= 60 && l.hold_duration_seconds < 180).length}/${losses.length}\n\n`;
  }

  // C. 与系统对比
  if (comparison) {
    md += `## C. 与虚拟实验对比\n\n`;
    md += `实验: ${comparisonReport?.experiment?.name || 'N/A'}\n\n`;

    md += `| 指标 | 值 |\n|---|---|\n`;
    md += `| 重叠代币 | ${comparison.overlapCount} (${comparison.overlapRate}% 覆盖率) |\n`;
    md += `| 仅钱包 | ${comparison.walletOnlyTotal} |\n`;
    md += `| 买入时间差中位数 | ${comparison.timeDiffMedian > 0 ? '+' : ''}${comparison.timeDiffMedian.toFixed(0)}秒 |\n`;
    md += `| 钱包先买 | ${comparison.walletFirstCount} 次 |\n`;
    md += `| 系统先买 | ${comparison.expFirstCount} 次 |\n`;
    md += `| 同步买入 (<5s) | ${comparison.sameTimeCount} 次 |\n`;

    if (comparison.overlapAvgWalletRoi != null) {
      md += `| 重叠-钱包平均ROI | ${comparison.overlapAvgWalletRoi.toFixed(1)}% |\n`;
      md += `| 重叠-实验平均ROI | ${comparison.overlapAvgExpRoi.toFixed(1)}% |\n`;
    }
    md += `\n`;

    // 漏买原因
    md += `### 系统未跟买原因排名\n\n`;
    md += `| 原因 | 总数 | 其中盈利 | 可捕获率 |\n|---|---|---|---|\n`;
    for (const [reason, count] of comparison.missedReasons) {
      const profitable = comparison.profitableMissedReasons.find(r => r[0] === reason);
      const pCount = profitable ? profitable[1] : 0;
      const captureRate = count > 0 ? (pCount / count * 100).toFixed(0) : '0';
      md += `| ${reason} | ${count} | ${pCount} | ${captureRate}% |\n`;
    }
    md += `\n`;

    md += `### 遗漏盈利机会\n\n`;
    md += `钱包独有盈利交易: ${comparison.profitableMissedCount}/${comparison.walletOnlyTotal}\n\n`;
  } else {
    md += `## C. 与虚拟实验对比\n\n`;
    md += `(未找到对比数据，请先运行 02-compare-with-experiment.js)\n\n`;
  }

  // D. 跟单可行性
  md += `## D. 跟单可行性评估\n\n`;

  if (profile.cv < 0.3) {
    md += `**买入金额**: 固定金额策略 (CV=${profile.cv.toFixed(2)})，容易复制\n\n`;
  } else {
    md += `**买入金额**: 变动金额 (CV=${profile.cv.toFixed(2)})，需要进一步分析金额调整逻辑\n\n`;
  }

  if (comparison && comparison.timeDiffMedian !== 0) {
    const delay = Math.abs(comparison.timeDiffMedian);
    if (delay < 10) {
      md += `**时机同步**: 时间差极小 (${delay.toFixed(0)}秒)，系统与钱包几乎同步\n\n`;
    } else if (delay < 60) {
      md += `**时机同步**: 时间差较小 (${delay.toFixed(0)}秒)，通过跟单可以实现\n\n`;
    } else {
      md += `**时机同步**: 时间差较大 (${delay.toFixed(0)}秒)，需要评估延迟对收益的影响\n\n`;
    }
  }

  md += `**PreBuyCheck**: `;
  if (comparison && comparison.profitableMissedReasons) {
    const notMonitored = comparison.profitableMissedReasons.find(r => r[0] === 'not_monitored');
    const noSignal = comparison.profitableMissedReasons.find(r => r[0] === 'no_signal');
    const precheckFailed = comparison.profitableMissedReasons.find(r => r[0] === 'precheck_failed');
    if (notMonitored && notMonitored[1] > 0) {
      md += `部分盈利代币未进入监控池 (${notMonitored[1]} 笔)，需扩大监控范围；`;
    }
    if (noSignal && noSignal[1] > 0) {
      md += `部分盈利代币未触发信号 (${noSignal[1]} 笔)，需放宽买入条件；`;
    }
    if (precheckFailed && precheckFailed[1] > 0) {
      md += `部分盈利代币被预检查拒绝 (${precheckFailed[1]} 笔)，需调整预检查阈值；`;
    }
  }
  md += `\n\n`;

  md += `**建议方向**:\n`;
  md += `1. 如果覆盖率高 (>50%)，优先调整买卖策略参数使其接近钱包行为\n`;
  md += `2. 如果覆盖率低 (<30%)，需要增加跟单收集器 (WalletFollowCollector)\n`;
  md += `3. 卖出策略参考钱包的持仓时长和止盈/止损分布\n`;
  md += `4. 预检查条件中，排除钱包也会规避的风险（如蜜罐、dev作恶），但放宽钱包能接受的风险\n`;

  return md;
}

// ---------- 主函数 ----------

let comparisonReport = null;

function main() {
  console.log('=== 汇总分析 ===\n');

  // 读取数据
  if (!fs.existsSync(WALLET_TRADES_FILE)) {
    console.error('请先运行 01-fetch-wallet-trades.js');
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(WALLET_TRADES_FILE, 'utf-8'));
  console.log(`钱包交易对: ${walletData.pairs?.length || 0}`);

  if (fs.existsSync(COMPARISON_FILE)) {
    comparisonReport = JSON.parse(fs.readFileSync(COMPARISON_FILE, 'utf-8'));
    console.log(`对比报告: ${comparisonReport.summary?.overlapCount || 0} 个重叠代币`);
  } else {
    console.log('未找到对比报告，仅分析钱包交易模式');
  }

  // 分析
  const profile = analyzeWalletProfile(walletData);
  const comparison = analyzeComparison(comparisonReport);

  // 生成报告
  const report = generateReport(walletData, profile, comparison);

  // 保存
  fs.writeFileSync(OUTPUT_FILE, report);
  console.log(`\n报告已保存到 ${OUTPUT_FILE}`);

  // 打印到终端
  console.log('\n' + '='.repeat(60));
  console.log(report);
}

main();
