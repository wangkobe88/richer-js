const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function query() {
  const EXP_ID = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";
  const TOKEN = "0xe079942b37bcfec88cea509bffbcf4d5365e4444";

  // 1. 获取代币基本信息
  console.log("=== 代币基本信息 ===");
  const { data: tokenInfo } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .maybeSingle();

  if (tokenInfo) {
    console.log("符号:", tokenInfo.token_symbol);
    console.log("状态:", tokenInfo.status);
    console.log("创建时间:", tokenInfo.created_at);
    console.log("发现时间:", tokenInfo.discovered_at);
    console.log("最大涨幅:", tokenInfo.analysis_results?.max_change_percent + "%");
  }

  // 2. 获取买入条件
  console.log("\n=== 实验买入条件 ===");
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', EXP_ID)
    .single();

  if (exp && exp.config) {
    const buyStrategies = exp.config.strategiesConfig?.buyStrategies || [];
    if (buyStrategies.length > 0) {
      console.log("条件:", buyStrategies[0].condition);
    }
  }

  // 3. 获取时序数据
  console.log("\n=== 时序数据（前30个点） ===");
  const { data: tsData } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .order('timestamp', { ascending: true })
    .limit(100);

  if (tsData && tsData.length > 0) {
    console.log("数据点数:", tsData.length);

    // 检查关键时间点
    tsData.slice(0, 50).forEach((row, i) => {
      const factors = row.factor_values || {};
      const age = factors.age || 0;
      const earlyReturn = factors.earlyReturn || 0;
      const holders = factors.holders || 0;
      const tvl = factors.tvl || 0;
      const trendCV = factors.trendCV || 0;

      // 每10秒显示一次关键数据
      if (i % 3 === 0 || (earlyReturn > 0 && earlyReturn < 50)) {
        const time = new Date(row.timestamp).toLocaleTimeString();
        console.log(`[${i + 1}] ${time} age=${age.toFixed(2)}min er=${earlyReturn.toFixed(1)}% h=${holders} tvl=${tvl.toFixed(0)} cv=${trendCV.toFixed(3)}`);
      }
    });
  } else {
    console.log("没有时序数据");
  }

  // 4. 检查是否有买入信号
  console.log("\n=== 买入信号 ===");
  const { data: buySignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .eq('action', 'buy');

  console.log("买入信号数量:", buySignals?.length || 0);

  // 5. 检查交易记录
  console.log("\n=== 交易记录 ===");
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN);

  console.log("交易数量:", trades?.length || 0);
}
query().catch(console.error);
