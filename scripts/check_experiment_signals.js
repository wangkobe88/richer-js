require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExperimentSignals() {
  const experimentId = '5aadb32a-37bb-419c-93d3-10818737426e';

  console.log('========================================');
  console.log(`实验: ${experimentId}`);
  console.log('========================================\n');

  // 1. 查询代币信息
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(20);

  if (tokensError) {
    console.log('代币查询错误:', tokensError.message);
    return;
  }

  console.log(`代币总数（前20个）: ${tokens?.length || 0}`);
  console.log('');

  let hasCreator = 0;
  let noCreator = 0;
  let monitoringCount = 0;
  let boughtCount = 0;

  tokens.forEach((token, i) => {
    const has = !!token.creator_address;
    if (has) hasCreator++;
    else noCreator++;

    if (token.status === 'monitoring') monitoringCount++;
    if (token.status === 'bought') boughtCount++;

    if (i < 5) {
      console.log(`${i + 1}. ${token.token_symbol || '(null)'}`);
      console.log(`   地址: ${token.token_address}`);
      console.log(`   状态: ${token.status}`);
      console.log(`   创建者: ${token.creator_address || '(null)'}`);
      console.log(`   创建时间: ${token.discovered_at}`);
      console.log('');
    }
  });

  console.log('统计:');
  console.log(`  有创建者: ${hasCreator}`);
  console.log(`  无创建者: ${noCreator}`);
  console.log(`  监控中: ${monitoringCount}`);
  console.log(`  已购买: ${boughtCount}`);
  console.log('');

  // 2. 查询时序数据 - 检查因子值
  const { data: timeSeries, error: tsError } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: false })
    .limit(100);

  if (tsError) {
    console.log('时序数据查询错误:', tsError.message);
  } else {
    console.log(`时序数据样本（最新100条）:`);

    // 统计因子值范围
    const ageValues = [];
    const earlyReturnValues = [];
    const holdersValues = [];

    timeSeries.forEach((ts) => {
      const factors = ts.factor_values || {};
      if (factors.age !== undefined) ageValues.push(factors.age);
      if (factors.earlyReturn !== undefined) earlyReturnValues.push(factors.earlyReturn);
      if (factors.holders !== undefined) holdersValues.push(factors.holders);
    });

    console.log(`  age 范围: ${Math.min(...ageValues).toFixed(2)} - ${Math.max(...ageValues).toFixed(2)} 分钟`);
    console.log(`  earlyReturn 范围: ${Math.min(...earlyReturnValues).toFixed(2)}% - ${Math.max(...earlyReturnValues).toFixed(2)}%`);
    console.log(`  holders 范围: ${Math.min(...holdersValues)} - ${Math.max(...holdersValues)}`);
    console.log('');

    // 检查有多少条数据符合买入条件
    const买入条件 = timeSeries.filter(ts => {
      const factors = ts.factor_values || {};
      const age = factors.age || 999;
      const earlyReturn = factors.earlyReturn || -1;
      const holders = factors.holders || 0;

      return age < 5 && earlyReturn >= 50 && earlyReturn < 150 && holders >= 10;
    });

    console.log(`符合买入条件的时序数据: ${买入条件.length} / ${timeSeries.length}`);

    if (买入条件.length > 0) {
      console.log('\n符合条件的前3条:');
      买入条件.slice(0, 3).forEach((ts, i) => {
        const factors = ts.factor_values || {};
        console.log(`  ${i + 1}. ${ts.token_symbol || '(null)'}`);
        console.log(`     时间: ${ts.timestamp}`);
        console.log(`     age: ${factors.age}, earlyReturn: ${factors.earlyReturn}%, holders: ${factors.holders}`);
      });
    }
  }

  // 3. 查看最新的几条时序数据
  console.log('\n最新的5条时序数据:');
  timeSeries.slice(0, 5).forEach((ts, i) => {
    const factors = ts.factor_values || {};
    console.log(`  ${i + 1}. ${ts.token_symbol || '(null)'} (${ts.token_address?.substring(0, 10)}...)`);
    console.log(`     时间: ${ts.timestamp}`);
    console.log(`     状态: ${ts.status}`);
    console.log(`     因子: age=${factors.age || 'N/A'}, earlyReturn=${factors.earlyReturn || 'N/A'}%, holders=${factors.holders || 'N/A'}`);
  });
}

checkExperimentSignals().catch(console.error);
