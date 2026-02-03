const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function queryExperiment() {
  const experimentId = '8f688916-a7a7-4501-badc-6cc3a5efc8d8';

  console.log('查询实验ID:', experimentId);

  // 查询实验表
  const { data: experiments, error: expError } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId);

  if (expError) {
    console.error('查询实验失败:', expError);
  } else {
    console.log('实验数据:', experiments);
  }

  // 查询代币表
  const { data: tokens, error: tokenError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(10);

  if (tokenError) {
    console.error('查询代币失败:', tokenError);
  } else {
    console.log('\n代币数据 (前10条):');
    tokens.forEach(t => {
      const symbol = t.token_symbol || 'N/A';
      const address = t.token_address ? t.token_address.substring(0, 10) + '...' : 'N/A';
      console.log('- ' + symbol + ' (' + address + '): ' + t.status);
    });
  }

  // 查询交易表
  const { data: trades, error: tradeError } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(10);

  if (tradeError) {
    console.error('查询交易失败:', tradeError);
  } else {
    console.log('\n交易数据 (前10条):');
    trades.forEach(t => {
      console.log('- ' + t.direction + ' ' + (t.token_symbol || 'N/A') + ': ' + t.amount + ' @ ' + t.price);
    });
  }

  // 查询信号表
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(10);

  if (signalError) {
    console.error('查询信号失败:', signalError);
  } else {
    console.log('\n信号数据 (前10条):');
    signals.forEach(s => {
      console.log('- ' + s.action + ' ' + s.signal_type + ': ' + (s.reason || 'N/A'));
    });
  }

  // 列出所有实验
  const { data: allExperiments, error: allExpError } = await supabase
    .from('experiments')
    .select('id, experiment_name, status')
    .order('created_at', { ascending: false })
    .limit(20);

  if (allExpError) {
    console.error('查询所有实验失败:', allExpError);
  } else {
    console.log('\n所有实验 (最近20个):');
    allExperiments.forEach(e => {
      console.log('- ' + e.id + ': ' + e.experiment_name + ' (' + e.status + ')');
    });
  }
}

queryExperiment().catch(console.error);
