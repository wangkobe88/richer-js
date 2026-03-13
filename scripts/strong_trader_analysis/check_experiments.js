const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/nobody1/Desktop/Codes/richer-js/config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkExperiments() {
  // 获取所有已停止/完成的实验
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, status, created_at, config')
    .in('status', ['stopped', 'completed'])
    .order('created_at', { ascending: false });

  console.log('总实验数:', experiments?.length || 0);

  // 获取每个实验的信号统计
  const results = [];

  for (const exp of experiments || []) {
    // 跳过回测实验
    if (exp.config?.backtest?.sourceExperimentId) {
      continue;
    }

    const { data: signals } = await supabase
      .from('strategy_signals')
      .select('id, token_address, metadata')
      .eq('experiment_id', exp.id)
      .eq('action', 'buy');

    if (!signals || signals.length === 0) continue;

    const executed = signals.filter(s => s.metadata?.execution_status === 'executed');
    const uniqueTokens = new Set(executed.map(s => s.token_address));

    results.push({
      id: exp.id,
      name: exp.config?.name || exp.id.slice(0, 8),
      signalCount: executed.length,
      tokenCount: uniqueTokens.size
    });
  }

  // 按 tokenCount 排序
  results.sort((a, b) => b.tokenCount - a.tokenCount);

  console.log('\n实验列表 (按代币数排序):');
  results.forEach((r, idx) => {
    console.log((idx + 1) + '. ' + r.name + ' (' + r.id.slice(0, 8) + ')');
    console.log('   代币数: ' + r.tokenCount + ', 信号数: ' + r.signalCount);
  });
}

checkExperiments().catch(console.error);
