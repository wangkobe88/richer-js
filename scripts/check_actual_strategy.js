const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取虚拟交易实验的配置
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .single();

  if (!exp) {
    console.log('实验不存在');
    return;
  }

  console.log('=== 虚拟交易实验配置 ===\n');
  console.log('名称:', exp.experiment_name);
  console.log('配置:', JSON.stringify(exp.config, null, 2));

  // 查看该实验的买入信号，使用的是什么条件
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .eq('action', 'buy')
    .order('created_at', { ascending: false })
    .limit(10);

  if (buySignals && buySignals.length > 0) {
    console.log('\n=== 最近10个买入信号 ===\n');
    for (const s of buySignals) {
      const factors = s.metadata || {};
      console.log(`${s.token_symbol} | ${s.reason}`);
      console.log(`  earlyReturn: ${factors.earlyReturn?.toFixed(2) || 'N/A'}%`);
      console.log(`  riseSpeed: ${factors.riseSpeed?.toFixed(2) || 'N/A'}`);
      console.log(`  trendCV: ${factors.trendCV?.toFixed(4) || 'N/A'}`);
      console.log(`  trendDirectionCount: ${factors.trendDirectionCount || 'N/A'}`);
      console.log(`  trendStrengthScore: ${factors.trendStrengthScore?.toFixed(2) || 'N/A'}`);
      console.log(`  trendConsecutiveDowns: ${factors.trendConsecutiveDowns || 'N/A'}`);
      console.log('');
    }
  }
})();
