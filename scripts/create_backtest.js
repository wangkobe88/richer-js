const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const sourceExperimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';
  const experimentId = uuidv4();

  const config = {
    backtest: {
      sourceExperimentId: sourceExperimentId,
      initialBalance: 10,
      tradeAmount: 0.1
    },
    strategy: {
      positionManagement: {
        enabled: true,
        totalCards: 4,
        perCardMaxBNB: 0.25
      }
    }
  };

  const { data, error } = await supabase
    .from('experiments')
    .insert([{
      id: experimentId,
      experiment_name: '测试回测数据加载',
      trading_mode: 'backtest',
      blockchain: 'bsc',
      kline_type: '1m',
      status: 'initializing',
      config: config
    }])
    .select()
    .single();

  if (error) {
    console.log('创建失败:', error.message);
  } else {
    console.log('✅ 回测实验已创建');
    console.log('实验ID:', experimentId);
    console.log('名称:', data.name);
  }
})();
