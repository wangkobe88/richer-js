/**
 * 详细检查满足所有条件的代币
 * 看看是否真的在同一时刻同时满足所有条件
 */

const { dbManager } = require('../src/services/dbManager');

async function checkAllConditionsMetTokens() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';

  const tokensToCheck = [
    { symbol: 'Omega', address: '0x6ebd72574227105bfc701e9b0559535a21a74444' },
    { symbol: '链式聊天', address: '0x692e85637eded0b84e1e028efe16b16a4dff4444' },
    { symbol: '清醒与沉沦', address: '0x1161a3750451bccc07c4e0f1b0166b9c78694444' },
    { symbol: 'MOSS', address: '0xb27ee82d52e741b11d87993fc244978e834bffff' },
    { symbol: '川皇', address: '0x384d4a308541bb746c4c70287da09e3253bd4444' },
    { symbol: '币安人生', address: '0x6592964945502bef4bb75e9bdf1d02b002ee4444' }
  ];

  for (const token of tokensToCheck) {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`🪙 ${token.symbol} (${token.address})`);

    // 获取时序数据
    const { data: timeSeriesData } = await supabase
      .from('experiment_time_series_data')
      .select('*')
      .eq('experiment_id', experimentId)
      .eq('token_address', token.address)
      .order('loop_count', { ascending: true });

    if (!timeSeriesData || timeSeriesData.length === 0) {
      console.log('  无时序数据');
      continue;
    }

    console.log(`  时序数据点数: ${timeSeriesData.length}`);

    // 检查每个时间点
    let foundAllMet = false;
    let metLoop = null;
    let closeCalls = [];

    for (const ts of timeSeriesData) {
      const f = typeof ts.factor_values === 'string' ? JSON.parse(ts.factor_values) : ts.factor_values;

      // 检查所有条件
      const checks = {
        trendCV: f.trendCV > 0.005,
        directionCount: f.trendDirectionCount >= 2,
        strengthScore: f.trendStrengthScore >= 30,
        totalReturn: f.trendTotalReturn >= 5,
        tvl: f.tvl >= 3000,
        txVolume: f.txVolumeU24h >= 3500,
        holders: f.holders >= 25,
        downRatio: f.trendRecentDownRatio < 0.5,
        consecutiveDowns: f.trendConsecutiveDowns < 2,
        earlyReturn: f.earlyReturn < 160,
        drawdown: f.drawdownFromHighest > -25
      };

      const metCount = Object.values(checks).filter(v => v).length;

      // 如果接近满足（10/11个条件），记录下来
      if (metCount >= 10) {
        closeCalls.push({
          loop: ts.loop_count,
          age: f.age,
          earlyReturn: f.earlyReturn,
          failedCondition: Object.keys(checks).find(k => !checks[k])
        });
      }

      // 所有条件都满足
      if (metCount === 11) {
        foundAllMet = true;
        metLoop = { loop: ts.loop_count, factors: f, checks };
        break;
      }
    }

    if (foundAllMet) {
      console.log(`  ✅ Loop ${metLoop.loop} 所有条件同时满足!`);
      console.log(`     age: ${metLoop.factors.age}`);
      console.log(`     earlyReturn: ${metLoop.factors.earlyReturn}`);
    } else {
      console.log(`  ❌ 从未同时满足所有条件`);

      // 显示最接近满足的几次
      if (closeCalls.length > 0) {
        console.log(`  最接近的情况 (${closeCalls.length} 次):`);
        closeCalls.slice(0, 3).forEach(call => {
          console.log(`     Loop ${call.loop}: ${call.metCount || 11}/11 条件满足, 失败: ${call.failedCondition}`);
          console.log(`       age=${call.age?.toFixed(2)}, earlyReturn=${call.earlyReturn?.toFixed(2)}`);
        });
      }
    }

    // 分析哪些条件最难满足
    const conditionStats = {
      trendCV: 0,
      directionCount: 0,
      strengthScore: 0,
      totalReturn: 0,
      tvl: 0,
      txVolume: 0,
      holders: 0,
      downRatio: 0,
      consecutiveDowns: 0,
      earlyReturn: 0,
      drawdown: 0
    };

    for (const ts of timeSeriesData) {
      const f = typeof ts.factor_values === 'string' ? JSON.parse(ts.factor_values) : ts.factor_values;
      if (f.trendCV > 0.005) conditionStats.trendCV++;
      if (f.trendDirectionCount >= 2) conditionStats.directionCount++;
      if (f.trendStrengthScore >= 30) conditionStats.strengthScore++;
      if (f.trendTotalReturn >= 5) conditionStats.totalReturn++;
      if (f.tvl >= 3000) conditionStats.tvl++;
      if (f.txVolumeU24h >= 3500) conditionStats.txVolume++;
      if (f.holders >= 25) conditionStats.holders++;
      if (f.trendRecentDownRatio < 0.5) conditionStats.downRatio++;
      if (f.trendConsecutiveDowns < 2) conditionStats.consecutiveDowns++;
      if (f.earlyReturn < 160) conditionStats.earlyReturn++;
      if (f.drawdownFromHighest > -25) conditionStats.drawdown++;
    }

    const totalPoints = timeSeriesData.length;
    console.log(`\n  条件满足率 (总共${totalPoints}个数据点):`);
    console.log(`     trendCV>0.005: ${conditionStats.trendCount}/${totalPoints} (${(conditionStats.trendCount/totalPoints*100).toFixed(1)}%)`);
    console.log(`     directionCount>=2: ${conditionStats.directionCount}/${totalPoints} (${(conditionStats.directionCount/totalPoints*100).toFixed(1)}%)`);
    console.log(`     strengthScore>=30: ${conditionStats.strengthScore}/${totalPoints} (${(conditionStats.strengthScore/totalPoints*100).toFixed(1)}%)`);
    console.log(`     totalReturn>=5%: ${conditionStats.totalReturn}/${totalPoints} (${(conditionStats.totalReturn/totalPoints*100).toFixed(1)}%)`);
    console.log(`     tvl>=3000: ${conditionStats.tvl}/${totalPoints} (${(conditionStats.tvl/totalPoints*100).toFixed(1)}%)`);
    console.log(`     txVolume>=3500: ${conditionStats.txVolume}/${totalPoints} (${(conditionStats.txVolume/totalPoints*100).toFixed(1)}%)`);
    console.log(`     holders>=25: ${conditionStats.holders}/${totalPoints} (${(conditionStats.holders/totalPoints*100).toFixed(1)}%)`);
    console.log(`     earlyReturn<160: ${conditionStats.earlyReturn}/${totalPoints} (${(conditionStats.earlyReturn/totalPoints*100).toFixed(1)}%)`);
    console.log(`     drawdown>-25: ${conditionStats.drawdown}/${totalPoints} (${(conditionStats.drawdown/totalPoints*100).toFixed(1)}%)`);
  }

  process.exit(0);
}

checkAllConditionsMetTokens()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
