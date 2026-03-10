const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkBacktestConfig() {
  const experimentId = '233e4d94-e771-463a-9296-a93483a9ce96';

  // 获取实验配置
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .maybeSingle();

  if (!exp) {
    console.log('实验不存在');
    return;
  }

  console.log('=== 回测实验配置 ===\n');
  console.log('ID:', exp.id);
  console.log('Name:', exp.name);
  console.log('Created at:', exp.created_at);
  console.log('Updated at:', exp.updated_at);
  console.log('');

  const sourceExpId = exp.config?.backtest?.sourceExperimentId;
  console.log('源实验 ID:', sourceExpId);
  console.log('');

  // 检查源实验的代币数量
  if (sourceExpId) {
    const { count } = await supabase
      .from('experiment_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', sourceExpId);

    console.log('源实验代币总数:', count);
    console.log('');

    // 检查 1$ 代币的位置
    const targetAddress = '0x6b0fd53e4676b99dd80051b73cb7260d926c4444';
    
    // 先查总数
    const { data: allTokens } = await supabase
      .from('experiment_tokens')
      .select('token_address')
      .eq('experiment_id', sourceExpId);
      
    const position = allTokens?.findIndex(t => t.token_address === targetAddress);
    
    if (position !== -1) {
      console.log(`✅ 1$ 代币位置: ${position + 1}`);
      if (position >= 1000) {
        console.log('   ⚠️  超出默认 1000 行限制，需要设置 limit(10000)');
      } else {
        console.log('   ✅ 在默认 1000 行限制内');
      }
    } else {
      console.log('❌ 1$ 代币未找到');
    }
  }
}

checkBacktestConfig().catch(console.error);
