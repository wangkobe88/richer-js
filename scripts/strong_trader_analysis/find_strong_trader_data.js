const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function findStrongTraderData() {
  // 查找有 strongTraderNetPositionRatio 数据的实验
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, trading_mode, status, created_at')
    .in('trading_mode', ['virtual', 'backtest'])
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('检查最近的实验是否有 strongTraderNetPositionRatio 数据:\n');

  for (const exp of experiments || []) {
    const { data: testSignal } = await supabase
      .from('strategy_signals')
      .select('metadata')
      .eq('experiment_id', exp.id)
      .limit(1);

    if (testSignal && testSignal[0]) {
      const factors = testSignal[0].metadata?.preBuyCheckFactors || {};
      const hasStrongTrader = factors.strongTraderNetPositionRatio !== undefined || factors.strongTraderCount !== undefined;

      if (hasStrongTrader) {
        console.log(`${exp.id.slice(0, 8)}... | ${exp.trading_mode} | ${exp.status}`);

        // 获取所有有 preBuyCheckFactors 的信号
        const { data: signals } = await supabase
          .from('strategy_signals')
          .select('id, token_symbol, metadata')
          .eq('experiment_id', exp.id)
          .not('metadata->preBuyCheckFactors', 'null')
          .limit(1000);

        if (signals && signals.length > 0) {
          const ratios = signals.map(s => s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio).filter(r => r !== undefined && r !== null);
          const counts = signals.map(s => s.metadata?.preBuyCheckFactors?.strongTraderCount).filter(c => c !== undefined && c !== null);

          const executed = signals.filter(s => s.metadata?.executed === true).length;

          console.log(`  信号数: ${signals.length}, 执行: ${executed}`);

          if (ratios.length > 0) {
            ratios.sort((a, b) => a - b);
            console.log(`  strongTraderNetPositionRatio (${ratios.length} 个): [${ratios[0]?.toFixed(1)}, ${ratios[ratios.length-1]?.toFixed(1)}], 中位数 ${ratios[Math.floor(ratios.length/2)]?.toFixed(1)}`);

            // 统计各阈值下的比例
            const thresholds = [1, 3, 5, 7, 10, 15];
            thresholds.forEach(th => {
              const geTh = ratios.filter(r => r >= th).length;
              const pct = (geTh / ratios.length * 100).toFixed(1);
              console.log(`    >= ${th}: ${geTh} (${pct}%)`);
            });
          }

          if (counts.length > 0) {
            counts.sort((a, b) => a - b);
            console.log(`  strongTraderCount (${counts.length} 个): [${counts[0]}, ${counts[counts.length-1]}], 中位数 ${counts[Math.floor(counts.length/2)]}`);
          }
        }
        console.log('');
      }
    }
  }
}

findStrongTraderData().catch(console.error);
