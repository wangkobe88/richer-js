require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExperimentCreator() {
  const experimentId = '32d18934-dd5c-4261-8f14-93bb60ae434f';

  console.log('========================================');
  console.log(`实验: ${experimentId}`);
  console.log('========================================\n');

  // 1. 查询实验信息
  const { data: experiment, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (expError) {
    console.log('实验查询错误:', expError.message);
    return;
  }

  console.log('实验信息:');
  console.log('  名称:', experiment.experiment_name);
  console.log('  模式:', experiment.trading_mode);
  console.log('  区块链:', experiment.blockchain);
  console.log('  创建时间:', experiment.created_at);
  console.log('');

  // 2. 查询所有代币及其创建者地址
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, creator_address, created_at')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (tokensError) {
    console.log('代币查询错误:', tokensError.message);
    return;
  }

  console.log(`代币总数: ${tokens?.length || 0}`);
  console.log('');

  let hasCreator = 0;
  let noCreator = 0;

  tokens.forEach((token, i) => {
    const has = !!token.creator_address;
    if (has) hasCreator++;
    else noCreator++;

    console.log(`${i + 1}. ${token.token_symbol || '(null)'}`);
    console.log(`   地址: ${token.token_address}`);
    console.log(`   创建者: ${token.creator_address || '(null)'}`);
    console.log(`   状态: ${has ? '✅ 有创建者' : '❌ 无创建者'}`);
    console.log('');
  });

  console.log('========================================');
  console.log('统计:');
  console.log(`  有创建者: ${hasCreator}`);
  console.log(`  无创建者: ${noCreator}`);
  console.log('========================================');
}

checkExperimentCreator().catch(console.error);
