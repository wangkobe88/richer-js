require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyAgeCalculation() {
  // 使用特定实验ID，避免查询过多数据
  const experimentId = '6eddf257-0564-4377-96d3-2c1a9430b28a';

  // 获取最近的一条时序数据
  const { data: timeSeries, error } = await supabase
    .from('experiment_time_series_data')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('timestamp', { ascending: false })
    .limit(5);

  if (error) {
    console.log('查询错误:', error.message);
    return;
  }

  console.log(`验证 age 计算（实验: ${experimentId.slice(0, 8)}...）:\n`);
  console.log('修改后 age = (当前时间 - 代币创建时间 created_at) / 1000 / 60\n');

  for (let i = 0; i < Math.min(timeSeries.length, 3); i++) {
    const ts = timeSeries[i];
    const factors = ts.factor_values || {};
    const rawData = ts.raw_api_data || {};

    // 获取代币创建时间（AVE API 的 created_at）
    const tokenCreatedAt = rawData.created_at;
    const tokenCreatedTime = tokenCreatedAt ? new Date(tokenCreatedAt * 1000) : null;

    // 当前时间
    const now = new Date();

    // 手动计算正确的 age
    let correctAge = null;
    if (tokenCreatedTime) {
      correctAge = (now - tokenCreatedTime) / 1000 / 60;
    }

    console.log(`${i + 1}. 代币: ${ts.token_symbol || '(null)'}`);
    console.log(`   地址: ${ts.token_address.slice(0, 10)}...`);
    console.log(`   代币创建时间 (created_at): ${tokenCreatedTime ? tokenCreatedTime.toISOString() : '(null)'}`);
    console.log(`   当前时间: ${now.toISOString()}`);
    console.log(`   实际 age (分钟): ${correctAge !== null ? correctAge.toFixed(2) : '(无法计算)'}`);
    console.log(`   系统记录 age: ${factors.age !== undefined ? factors.age.toFixed(2) : '(null)'}`);

    // 验证是否匹配
    if (correctAge !== null && factors.age !== undefined) {
      const diff = Math.abs(correctAge - factors.age);
      if (diff < 2) {
        console.log(`   ✅ 匹配正确 (差异: ${diff.toFixed(2)} 分钟)`);
      } else {
        console.log(`   ⚠️ 差异较大: ${diff.toFixed(2)} 分钟 (可能数据未刷新)`);
      }
    } else {
      console.log(`   ⚠️ 无法验证 (缺少数据)`);
    }
    console.log('');
  }
}

verifyAgeCalculation().catch(console.error);
