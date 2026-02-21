const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const experimentId = '0971b4f0-ea88-4e72-a80f-6fe9b98f2bdd';

  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (error) {
    console.log('查询失败:', error.message);
  } else {
    console.log('=== 实验状态 ===');
    console.log('ID:', data.id);
    console.log('名称:', data.experiment_name);
    console.log('状态:', data.status);
    console.log('交易模式:', data.trading_mode);
    console.log('启动时间:', data.started_at);
    console.log('停止时间:', data.stopped_at);
    console.log('更新时间:', data.updated_at);
  }
})();
