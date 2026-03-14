const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeExperiments() {
  const expIds = [
    'bc4fef83-2454-421b-9694-7820b7c0dc5e',
    'a84aa918-8e5f-4565-9a90-6b7f8a05275f',
    'a2ee5c27-3788-48fa-8735-858cbc60fcad',
    'f8cf4ff3-25ce-4e93-8486-8d6c8c1e7d9c'
  ];

  for (const expId of expIds) {
    console.log(`\n${'='.repeat(60)}`);
    // 获取实验信息
    const { data: exp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', expId)
      .single();

    console.log(`实验: ${expId.slice(0, 8)}...`);
    console.log(`类型: ${exp?.trading_mode || 'N/A'}`);
    console.log(`状态: ${exp?.status || 'N/A'}`);
    console.log(`配置: ${exp?.config?.name || 'N/A'}`);

    if (!exp) continue;

    // 检查买入条件
    const buyConditions = exp.config?.strategiesConfig?.buyStrategies || [];
    if (buyConditions.length > 0) {
      console.log('\n买入条件中的 strongTrader 相关:');
      buyConditions.forEach((s, i) => {
        const cond = s.preBuyCheckCondition || '';
        if (cond.includes('strongTrader')) {
          console.log(`  Card ${i+1}: ${cond}`);
        }
      });
    }

    // 获取信号数据
    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('id, token_symbol, metadata, executed, execution_reason')
      .eq('experiment_id', expId)
      .not('metadata->preBuyCheckFactors', 'null')
      .limit(1000);

    if (signals && signals.length > 0) {
      const executed = signals.filter(s => s.executed).length;
      const notExecuted = signals.filter(s => !s.executed).length;
      console.log(`\n信号统计: ${signals.length} 总数, ${executed} 执行, ${notExecuted} 未执行`);

      // 分析 strongTraderNetPositionRatio
      const ratios = signals.map(s => s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio).filter(r => r !== undefined && r !== null);

      if (ratios.length > 0) {
        ratios.sort((a, b) => a - b);

        console.log('\nstrongTraderNetPositionRatio 分布:');
        console.log(`  样本数: ${ratios.length}`);
        console.log(`  范围: [${ratios[0].toFixed(2)}, ${ratios[ratios.length-1].toFixed(2)}]`);
        console.log(`  平均值: ${(ratios.reduce((a,b) => a+b, 0) / ratios.length).toFixed(2)}`);
        console.log(`  中位数: ${ratios[Math.floor(ratios.length/2)].toFixed(2)}`);

        // 分位数
        [10, 25, 50, 75, 90, 95, 99].forEach(p => {
          const idx = Math.floor(ratios.length * p / 100);
          console.log(`  ${p}%: ${ratios[idx].toFixed(2)}`);
        });

        // 分析不同阈值的影响
        console.log('\n不同阈值下的执行情况:');
        const thresholds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
        thresholds.forEach(th => {
          const totalUnderTh = ratios.filter(r => r < th).length;
          const executedUnderTh = signals.filter(s => {
            const r = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
            return r !== undefined && r < th && s.executed;
          }).length;

          if (totalUnderTh > 0) {
            const execRate = (executedUnderTh / totalUnderTh * 100).toFixed(1);
            console.log(`  < ${th}: ${executedUnderTh}/${totalUnderTh} (${execRate}% 执行)`);
          }
        });

        // 分析被 strongTraderNetPositionRatio >= 5 过滤的信号
        const filtered = signals.filter(s => {
          const r = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
          return r !== undefined && r >= 5 && !s.executed;
        });

        if (filtered.length > 0) {
          console.log(`\n被 strongTraderNetPositionRatio >= 5 过滤: ${filtered.length} 个`);
          console.log('这些信号的 strongTraderNetPositionRatio 值:');
          filtered.sort((a, b) => (b.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio || 0) - (a.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio || 0));
          filtered.slice(0, 10).forEach(s => {
            const r = s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio;
            console.log(`  ${s.token_symbol}: ${r.toFixed(2)}`);
          });
        }
      }
    }
  }
}

analyzeExperiments().catch(console.error);
