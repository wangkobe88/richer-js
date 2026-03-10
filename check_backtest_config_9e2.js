const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkBacktestConfig() {
  const experimentId = '9e227ea2-4c0c-4864-8d8e-3b92779dd794';

  const { data: exp, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .maybeSingle();

  if (error) {
    console.log('Error:', error);
    return;
  }

  if (!exp) {
    console.log('实验不存在');
    return;
  }

  console.log('=== 回测实验配置 ===\n');
  console.log('ID:', exp.id);
  console.log('Name:', exp.name);
  console.log('Mode:', exp.mode);
  console.log('Status:', exp.status);
  console.log('');

  console.log('=== Config ===\n');
  const config = exp.config;
  console.log('Source Experiment ID:', config?.backtest?.sourceExperimentId);
  console.log('Has PreBuyCheck:', !!config?.preBuyCheckConfig);
  console.log('');

  if (config?.preBuyCheckConfig) {
    console.log('=== PreBuyCheck Config ===\n');
    console.log(JSON.stringify(config.preBuyCheckConfig, null, 2));
  }
}

checkBacktestConfig().catch(console.error);
