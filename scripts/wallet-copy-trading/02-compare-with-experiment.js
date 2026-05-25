/**
 * Step 2: 与当前虚拟实验对比同代币买卖点
 *
 * 对比层次：
 * 1. 钱包买入的代币 vs 实验监控池 (experiment_tokens) — 是否被监控
 * 2. 被监控的代币 vs 买入信号 (strategy_signals) — 信号是否触发
 * 3. 有信号的代币 vs 时序数据 (experiment_time_series_data) — 买入时的因子值
 * 4. 都买的代币 — 买卖时间/价格差异
 *
 * 用法: node scripts/wallet-copy-trading/02-compare-with-experiment.js
 */

const fs = require('fs');
const path = require('path');
const { init, getSupabase, WALLET_ADDRESS, CHAIN, DATA_DIR } = require('./config');

const WALLET_TRADES_FILE = path.join(DATA_DIR, 'wallet-trades.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'comparison-report.json');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatTime(ts) {
  if (!ts) return 'N/A';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 查找当前运行的 solana 虚拟交易实验
 */
async function findRunningExperiment(supabase) {
  console.log('\n[1/6] 查找运行中的虚拟交易实验...');

  const { data, error } = await supabase
    .from('experiments')
    .select('id, experiment_name, status, trading_mode, blockchain, created_at, config')
    .eq('blockchain', 'solana')
    .eq('trading_mode', 'virtual')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('  查询实验失败:', error.message);
    return null;
  }

  const running = data?.find(e => e.status === 'running') || data?.[0];
  if (!running) {
    console.log('  未找到 solana 虚拟交易实验');
    return null;
  }

  console.log(`  实验: ${running.experiment_name} (${running.id})`);
  console.log(`  状态: ${running.status}, 创建于: ${running.created_at}`);

  // 计算实验运行时长
  const expStart = new Date(running.created_at).getTime() / 1000;
  const runningHours = ((Date.now() / 1000 - expStart) / 3600).toFixed(1);
  console.log(`  运行时长: ${runningHours} 小时`);

  // 打印买入策略条件
  const buyStrategies = running.config?.strategiesConfig?.buyStrategies || [];
  if (buyStrategies.length > 0) {
    console.log(`  买入条件: ${buyStrategies[0].condition?.slice(0, 100)}...`);
    console.log(`  预检查条件: ${buyStrategies[0].preBuyCheckCondition?.slice(0, 100) || '(无)'}`);
  }

  return { ...running, _expStartTimestamp: expStart };
}

/**
 * 获取实验的买入信号（不仅是执行了的交易）
 */
async function fetchBuySignals(supabase, experimentId) {
  console.log('\n[2/6] 获取实验买入信号（分页取全）...');

  // 先查总数
  const { count } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId)
    .in('signal_type', ['BUY', 'buy']);
  console.log(`  买入信号总数: ${count}`);

  const allSignals = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', experimentId)
      .in('signal_type', ['BUY', 'buy'])
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('  查询信号失败:', error.message);
      break;
    }

    allSignals.push(...(data || []));
    console.log(`  已获取: ${allSignals.length}/${count}`);
    if (!data || data.length === 0) break;
    offset += pageSize;
  }

  const executed = allSignals.filter(s => s.executed);
  const notExecuted = allSignals.filter(s => !s.executed);
  console.log(`  买入信号: ${allSignals.length} (已执行: ${executed.length}, 未执行: ${notExecuted.length})`);
  return allSignals;
}

/**
 * 获取实验的卖出信号
 */
async function fetchSellSignals(supabase, experimentId) {
  const allSignals = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('strategy_signals')
      .select('*')
      .eq('experiment_id', experimentId)
      .in('signal_type', ['SELL', 'sell'])
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) break;
    allSignals.push(...(data || []));
    if (!data || data.length === 0) break;
    offset += pageSize;
  }

  return allSignals;
}

/**
 * 获取实验监控的所有代币（分页取全）
 */
async function fetchExperimentTokens(supabase, experimentId) {
  console.log('\n[3/6] 获取实验监控代币（分页取全）...');

  const { count } = await supabase
    .from('experiment_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);
  console.log(`  代币总数: ${count}`);

  const allTokens = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('experiment_tokens')
      .select('token_address, token_symbol, status, discovered_at, platform, creator_address')
      .eq('experiment_id', experimentId)
      .order('discovered_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('  查询代币失败:', error.message);
      break;
    }

    allTokens.push(...(data || []));
    console.log(`  已获取: ${allTokens.length}/${count}`);
    if (!data || data.length === 0) break;
    offset += pageSize;
  }

  const tokenMap = new Map();
  for (const t of allTokens) {
    tokenMap.set(t.token_address, t);
  }
  console.log(`  去重后监控代币数: ${tokenMap.size}`);
  return tokenMap;
}

/**
 * 获取指定代币的时序数据（因子快照）
 */
async function fetchTokenTimeSeries(supabase, experimentId, tokenAddress) {
  const { data, error } = await supabase
    .from('experiment_time_series_data')
    .select('timestamp, price_usd, factor_values')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .order('timestamp', { ascending: true })
    .limit(200);

  if (error) return [];
  return data || [];
}

/**
 * 对比分析
 */
async function performComparison(walletData, buySignals, sellSignals, expTokenMap, supabase, experimentId, expStartTimestamp) {
  console.log('\n[4/6] 执行分层对比...');

  // 只保留实验运行时间段内的钱包交易对
  const allWalletPairs = walletData.pairs || [];
  const walletPairs = allWalletPairs.filter(p => p.buy_time >= expStartTimestamp);
  console.log(`  钱包总交易对: ${allWalletPairs.length}, 实验期间内: ${walletPairs.length}`);

  const walletTokenAddrs = new Set(walletPairs.map(p => p.token_address));

  // 构建信号索引
  const buySignalMap = new Map(); // token_address -> [signals]
  for (const s of buySignals) {
    const addr = s.token_address;
    if (!buySignalMap.has(addr)) buySignalMap.set(addr, []);
    buySignalMap.get(addr).push(s);
  }

  const sellSignalMap = new Map();
  for (const s of sellSignals) {
    const addr = s.token_address;
    if (!sellSignalMap.has(addr)) sellSignalMap.set(addr, []);
    sellSignalMap.get(addr).push(s);
  }

  // 实验已买入的代币（信号执行了）
  const expExecutedBuys = new Set(
    buySignals.filter(s => s.executed).map(s => s.token_address)
  );

  // ---- 分层分类 ----
  const layers = {
    monitored_no_signal: [],    // 在监控池但没触发买入信号
    monitored_signal_rejected: [], // 触发了信号但未执行（预检查拒绝）
    monitored_signal_executed: [], // 触发了信号且执行了（重叠）
    not_monitored: [],          // 根本不在监控池
  };

  for (const wp of walletPairs) {
    const addr = wp.token_address;
    const inPool = expTokenMap.has(addr);
    const hasSignal = buySignalMap.has(addr);

    if (!inPool) {
      layers.not_monitored.push(wp);
      continue;
    }

    if (!hasSignal) {
      // 在监控池但没有买入信号 → 拉取时序数据分析因子差距
      layers.monitored_no_signal.push(wp);
      continue;
    }

    const signals = buySignalMap.get(addr);
    const executedSignal = signals.find(s => s.executed);
    const rejectedSignal = signals.find(s => !s.executed);

    if (executedSignal) {
      layers.monitored_signal_executed.push({ walletPair: wp, signal: executedSignal });
    } else if (rejectedSignal) {
      layers.monitored_signal_rejected.push({ walletPair: wp, signal: rejectedSignal });
    } else {
      layers.monitored_no_signal.push(wp);
    }
  }

  console.log(`  分层结果:`);
  console.log(`    不在监控池: ${layers.not_monitored.length}`);
  console.log(`    监控但无信号: ${layers.monitored_no_signal.length}`);
  console.log(`    信号被拒绝: ${layers.monitored_signal_rejected.length}`);
  console.log(`    信号已执行(重叠): ${layers.monitored_signal_executed.length}`);

  // ---- 深入分析每层 ----

  // Layer: 信号被拒绝 → 查看拒绝原因
  const rejectedDetails = [];
  for (const item of layers.monitored_signal_rejected) {
    const meta = item.signal.metadata || {};
    const preBuyFactors = meta.preBuyCheckFactors || {};
    const trendFactors = meta.trendFactors || {};

    rejectedDetails.push({
      token_address: item.walletPair.token_address,
      symbol: item.walletPair.symbol,
      wallet_buy_time: item.walletPair.buy_time,
      wallet_roi: item.walletPair.roi_percent,
      signal_time: formatTime(item.signal.created_at),
      reject_reason: meta.execution_reason || meta.reason || '未知',
      key_factors: {
        earlyReturn: trendFactors.earlyReturn,
        trendCV: trendFactors.trendCV,
        trendDataPoints: trendFactors.trendDataPoints,
        age: trendFactors.age,
        earlyTradesTotalCount: preBuyFactors.earlyTradesTotalCount,
        earlyTradesVolumePerMin: preBuyFactors.earlyTradesVolumePerMin,
        earlyTradesCountPerMin: preBuyFactors.earlyTradesCountPerMin,
        earlyTradesDrawdownFromHighest: preBuyFactors.earlyTradesDrawdownFromHighest,
        walletTop3VolumeRatio: preBuyFactors.walletTop3VolumeRatio,
        walletDiversityIndex: preBuyFactors.walletDiversityIndex,
        earlyTraderBlacklistCount: preBuyFactors.earlyTraderBlacklistCount,
        preBuyCheckCanBuy: preBuyFactors.canBuy,
        checkReason: preBuyFactors.checkReason,
      },
    });
  }

  // Layer: 监控但无信号 → 拉取时序数据，看该代币在钱包买入时点的因子值
  // 只分析前 30 个（避免过多 API 调用）
  const noSignalDetails = [];
  const toAnalyze = layers.monitored_no_signal.slice(0, 30);
  console.log(`\n[5/6] 分析无信号代币的因子差距 (前 ${toAnalyze.length} 个)...`);

  for (const wp of toAnalyze) {
    const timeSeries = await fetchTokenTimeSeries(supabase, experimentId, wp.token_address);

    // 找到钱包买入时间点最近的时序记录
    let closest = null;
    let minDiff = Infinity;
    for (const ts of timeSeries) {
      const tsTime = new Date(ts.timestamp).getTime() / 1000;
      const diff = Math.abs(tsTime - wp.buy_time);
      if (diff < minDiff) {
        minDiff = diff;
        closest = ts;
      }
    }

    noSignalDetails.push({
      token_address: wp.token_address,
      symbol: wp.symbol,
      wallet_buy_time: wp.buy_time,
      wallet_roi: wp.roi_percent,
      has_time_series: timeSeries.length > 0,
      closest_ts_distance_seconds: minDiff < Infinity ? Math.round(minDiff) : null,
      factors_at_buy_time: closest?.factor_values || null,
    });

    await sleep(50); // 轻微延迟
  }

  // Layer: 信号已执行(重叠) → 对比买卖点差异
  const overlapDetails = [];
  for (const item of layers.monitored_signal_executed) {
    const wp = item.walletPair;
    const sig = item.signal;
    const sigTime = new Date(sig.created_at).getTime() / 1000;

    // 查找对应的卖出信号
    const sellSigs = sellSignalMap.get(wp.token_address) || [];
    const executedSell = sellSigs.find(s => s.executed);

    const timeDiff = wp.buy_time - sigTime; // 正=钱包更晚
    const priceDiff = wp.buy_price_usd && sig.metadata?.price
      ? ((wp.buy_price_usd / sig.metadata.price) - 1) * 100
      : null;

    overlapDetails.push({
      token_address: wp.token_address,
      symbol: wp.symbol,
      wallet: {
        buy_time: wp.buy_time,
        buy_price_usd: wp.buy_price_usd,
        sell_time: wp.sell_time,
        sell_price_usd: wp.sell_price_usd,
        roi_percent: wp.roi_percent,
        hold_duration_seconds: wp.hold_duration_seconds,
      },
      experiment: {
        buy_time: sigTime,
        buy_price: sig.metadata?.price,
        sell_time: executedSell ? new Date(executedSell.created_at).getTime() / 1000 : null,
        sell_price: executedSell?.metadata?.price,
        sell_reason: executedSell?.reason || null,
      },
      buy_time_diff_seconds: Math.round(timeDiff),
      buy_price_diff_percent: priceDiff !== null ? Math.round(priceDiff * 100) / 100 : null,
    });
  }

  // ---- 统计拒绝原因排名 ----
  const rejectionReasonCounts = {};
  for (const d of rejectedDetails) {
    const reason = d.reject_reason || '未知';
    rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
  }

  // ---- 统计无信号代币中因子不满足的常见原因 ----
  const noSignalFactorGaps = analyzeNoSignalFactorGaps(noSignalDetails, experimentId);

  return {
    summary: {
      walletTotalPairs: walletPairs.length,
      notMonitored: layers.not_monitored.length,
      monitoredNoSignal: layers.monitored_no_signal.length,
      signalRejected: layers.monitored_signal_rejected.length,
      signalExecuted: layers.monitored_signal_executed.length,
      coverageRate: walletPairs.length > 0
        ? ((layers.monitored_signal_executed.length / walletPairs.length) * 100).toFixed(1)
        : '0',
      monitorRate: walletPairs.length > 0
        ? (((layers.monitored_signal_executed.length + layers.monitored_signal_rejected.length + layers.monitored_no_signal.length) / walletPairs.length) * 100).toFixed(1)
        : '0',
    },
    rejectedDetails,
    noSignalDetails,
    overlapDetails,
    notMonitoredTokens: layers.not_monitored.map(wp => ({
      token_address: wp.token_address,
      symbol: wp.symbol,
      wallet_roi: wp.roi_percent,
      wallet_buy_time: wp.buy_time,
    })),
    rejectionReasonCounts,
    noSignalFactorGaps,
  };
}

/**
 * 分析无信号代币的因子差距
 * 对比钱包买入时的因子值与买入策略条件
 */
function analyzeNoSignalFactorGaps(noSignalDetails, experimentId) {
  // 典型的买入条件（从 Pump029 实验获取）
  // trendDataPoints >= 6 AND trendCV >= 0.15 AND trendCV <= 0.5 AND earlyReturn >= 25
  // AND earlyReturn <= 200 AND trendSlope > 0.01 AND trendPriceUp >= 1
  // AND trendMedianUp >= 1 AND trendStrengthScore >= 25
  // AND trendRecentDownRatio < 0.6 AND trendRiseRatio >= 0.55 AND age < 3

  const gapCounts = {
    'trendDataPoints < 6': 0,
    'trendCV 范围外 (0.15~0.5)': 0,
    'earlyReturn 太低 (<25)': 0,
    'earlyReturn 太高 (>200)': 0,
    'trendSlope <= 0.01': 0,
    'trendPriceUp < 1': 0,
    'trendMedianUp < 1': 0,
    'trendStrengthScore < 25': 0,
    'trendRecentDownRatio >= 0.6': 0,
    'trendRiseRatio < 0.55': 0,
    'age >= 3': 0,
    '无时序数据': 0,
  };

  for (const item of noSignalDetails) {
    const f = item.factors_at_buy_time;
    if (!f) {
      gapCounts['无时序数据']++;
      continue;
    }

    if ((f.trendDataPoints || 0) < 6) gapCounts['trendDataPoints < 6']++;
    const cv = f.trendCV || 0;
    if (cv < 0.15 || cv > 0.5) gapCounts['trendCV 范围外 (0.15~0.5)']++;
    if ((f.earlyReturn || 0) < 25) gapCounts['earlyReturn 太低 (<25)']++;
    if ((f.earlyReturn || 0) > 200) gapCounts['earlyReturn 太高 (>200)']++;
    if ((f.trendSlope || 0) <= 0.01) gapCounts['trendSlope <= 0.01']++;
    if ((f.trendPriceUp || 0) < 1) gapCounts['trendPriceUp < 1']++;
    if ((f.trendMedianUp || 0) < 1) gapCounts['trendMedianUp < 1']++;
    if ((f.trendStrengthScore || 0) < 25) gapCounts['trendStrengthScore < 25']++;
    if ((f.trendRecentDownRatio || 0) >= 0.6) gapCounts['trendRecentDownRatio >= 0.6']++;
    if ((f.trendRiseRatio || 0) < 0.55) gapCounts['trendRiseRatio < 0.55']++;
    if ((f.age || 0) >= 3) gapCounts['age >= 3']++;
  }

  return Object.entries(gapCounts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * 打印报告
 */
function printReport(report) {
  console.log('\n=== 对比报告 ===');
  const s = report.summary;
  console.log(`\n分层概览:`);
  console.log(`  钱包总交易对: ${s.walletTotalPairs}`);
  console.log(`  不在监控池:   ${s.notMonitored} (${(s.notMonitored / s.walletTotalPairs * 100).toFixed(1)}%)`);
  console.log(`  监控但无信号: ${s.monitoredNoSignal}`);
  console.log(`  信号被拒绝:   ${s.signalRejected}`);
  console.log(`  信号已执行:   ${s.signalExecuted}`);
  console.log(`  监控覆盖率:   ${s.monitorRate}%`);
  console.log(`  执行覆盖率:   ${s.coverageRate}%`);

  // 信号被拒绝的原因排名
  if (Object.keys(report.rejectionReasonCounts).length > 0) {
    console.log(`\n信号拒绝原因排名:`);
    for (const [reason, count] of Object.entries(report.rejectionReasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}次] ${reason}`);
    }

    // 详细列出被拒绝的代币
    console.log(`\n被拒绝代币详情:`);
    for (const d of report.rejectedDetails) {
      const roi = d.wallet_roi !== null ? `${d.wallet_roi.toFixed(1)}%` : 'N/A';
      const profitable = d.wallet_roi && d.wallet_roi > 0 ? '✓盈利' : '✗亏损';
      console.log(`  ${d.symbol || d.token_address.slice(0, 12)}: ROI=${roi} ${profitable}`);
      console.log(`    拒绝: ${d.reject_reason}`);
      const kf = d.key_factors;
      if (kf.earlyReturn !== undefined) console.log(`    earlyReturn=${kf.earlyReturn}, trendCV=${kf.trendCV}, age=${kf.age}`);
      if (kf.preBuyCheckCanBuy !== undefined) console.log(`    预检查: canBuy=${kf.preBuyCheckCanBuy}, ${kf.checkReason || ''}`);
    }
  }

  // 无信号代币的因子差距排名
  if (report.noSignalFactorGaps.length > 0) {
    console.log(`\n无信号代币因子差距排名 (前 ${report.noSignalDetails.length} 个样本):`);
    for (const [gap, count] of report.noSignalFactorGaps) {
      console.log(`  [${count}次] ${gap}`);
    }
  }

  // 重叠代币对比
  if (report.overlapDetails.length > 0) {
    console.log(`\n重叠代币买卖点差异:`);
    for (const o of report.overlapDetails) {
      const tDiff = o.buy_time_diff_seconds;
      const pDiff = o.buy_price_diff_percent;
      console.log(`  ${o.symbol || o.token_address.slice(0, 12)}:`);
      console.log(`    时间差: ${tDiff > 0 ? '+' : ''}${tDiff}s, 价格差: ${pDiff !== null ? pDiff.toFixed(1) + '%' : 'N/A'}`);
      console.log(`    钱包: ROI=${o.wallet.roi_percent?.toFixed(1) || 'N/A'}%, 持仓=${o.wallet.hold_duration_seconds?.toFixed(0) || 'N/A'}s`);
      console.log(`    实验: 卖出原因=${o.experiment.sell_reason || 'N/A'}`);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 与虚拟实验对比（基于信号和时序数据）===');

  if (!fs.existsSync(WALLET_TRADES_FILE)) {
    console.error('请先运行 01-fetch-wallet-trades.js');
    process.exit(1);
  }
  const walletData = JSON.parse(fs.readFileSync(WALLET_TRADES_FILE, 'utf-8'));
  console.log(`钱包交易对: ${walletData.pairs?.length || 0}`);

  await init();
  const supabase = getSupabase();
  if (!supabase) {
    console.error('Supabase 未配置');
    process.exit(1);
  }

  const experiment = await findRunningExperiment(supabase);
  if (!experiment) {
    console.error('未找到运行中的实验');
    process.exit(1);
  }

  const buySignals = await fetchBuySignals(supabase, experiment.id);
  const sellSignals = await fetchSellSignals(supabase, experiment.id);
  const expTokenMap = await fetchExperimentTokens(supabase, experiment.id);

  const report = await performComparison(walletData, buySignals, sellSignals, expTokenMap, supabase, experiment.id, experiment._expStartTimestamp);
  report.experiment = {
    id: experiment.id,
    name: experiment.experiment_name,
    status: experiment.status,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n[6/6] 报告已保存到 ${OUTPUT_FILE}`);

  printReport(report);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
