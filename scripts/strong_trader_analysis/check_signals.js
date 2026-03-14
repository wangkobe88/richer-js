const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  // 检查回测实验的信号
  const { data: allSignals, count } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact' })
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad');

  console.log('回测实验 a2ee5c27 信号总数:', count || 0);

  const executed = allSignals?.filter(s => s.executed).length || 0;
  const notExecuted = allSignals?.filter(s => !s.executed).length || 0;

  console.log('  执行:', executed);
  console.log('  未执行:', notExecuted);

  // 检查原始虚拟实验的信号
  const { count: origCount } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact' })
    .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381');

  console.log('\n原始虚拟实验 015db965 信号总数:', origCount || 0);

  // 获取回测实验执行的信号，检查 strongTraderNetPositionRatio
  const { data: executedSignals } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, metadata')
    .eq('experiment_id', 'a2ee5c27-3788-48fa-8735-858cbc60fcad')
    .eq('executed', true);

  console.log('\n回测实验执行的信号的 strongTraderNetPositionRatio:');
  const ratios = executedSignals?.map(s => s.metadata?.preBuyCheckFactors?.strongTraderNetPositionRatio).filter(r => r != null) || [];
  if (ratios.length > 0) {
    ratios.sort((a, b) => a - b);
    console.log(`  样本数: ${ratios.length}`);
    console.log(`  最小值: ${ratios[0]?.toFixed(2)}`);
    console.log(`  最大值: ${ratios[ratios.length-1]?.toFixed(2)}`);
    console.log(`  中位数: ${ratios[Math.floor(ratios.length/2)]?.toFixed(2)}`);

    console.log('\n  分布:');
    [0, 25, 50, 75, 90, 95, 100].forEach(p => {
      const idx = Math.floor(ratios.length * p / 100);
      console.log(`    ${p}%: ${ratios[idx]?.toFixed(2)}`);
    });
  } else {
    console.log('  没有找到 strongTraderNetPositionRatio 数据');
  }
}

check().catch(console.error);
