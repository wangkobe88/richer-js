const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 检查信号是否存在
  const signalId = '195ea2b6-1b2a-4f19-bc1a-cc6acceaf646';
  
  const { data: signal } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('id', signalId)
    .single();

  if (signal) {
    console.log('信号存在于数据库中:');
    console.log('  ID:', signal.id);
    console.log('  实验ID:', signal.experiment_id);
    console.log('  代币:', signal.token_symbol);
    console.log('  动作:', signal.action);
    console.log('  执行:', signal.executed);
  } else {
    console.log('信号不存在于数据库中');
  }

  // 检查该信号关联的实验
  if (signal) {
    const { data: exp } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', signal.experiment_id)
      .single();

    if (exp) {
      console.log('\n关联的实验:');
      console.log('  ID:', exp.id);
      console.log('  名称:', exp.experiment_name);
      console.log('  模式:', exp.trading_mode);
      console.log('  状态:', exp.status);
    } else {
      console.log('\n关联的实验不存在于数据库中!');
      console.log('实验ID:', signal.experiment_id);
    }
  }
})();
