const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const experimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

  const { data: tokens, error } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .limit(3);

  if (error) {
    console.error('查询失败:', error);
    return;
  }

  console.log('experiment_tokens 表字段:', Object.keys(tokens[0] || {}).join(', '));

  if (tokens.length > 0) {
    const sample = tokens[0];
    console.log('\n第一条记录:');
    for (const key of Object.keys(sample)) {
      const val = sample[key];
      let display = String(val);
      if (val && typeof val === 'object') {
        display = JSON.stringify(val);
        if (display.length > 150) display = display.substring(0, 150) + '...';
      }
      console.log('  ' + key + ': ' + display);
    }
  }

  // 查找所有质量相关字段
  console.log('\n查找质量相关字段...');
  const qualityFields = ['quality_label', 'quality_score', 'quality', 'manual_quality', 'manual_quality_label', 'rating', 'grade'];

  for (const field of qualityFields) {
    const { data, count } = await supabase
      .from('experiment_tokens')
      .select(field, { count: 'exact', head: true })
      .eq('experiment_id', experimentId)
      .not(field, 'is', null);

    if (count && count > 0) {
      console.log(`  ${field}: ${count} 个非空记录`);
      // 获取样本值
      const { data: samples } = await supabase
        .from('experiment_tokens')
        .select(field)
        .eq('experiment_id', experimentId)
        .not(field, 'is', null)
        .limit(5);
      const values = samples.map(s => s[field]).filter((v, i, a) => a.indexOf(v) === i);
      console.log(`    样本值: ${values.join(', ')}`);
    }
  }

  // 统计总数
  const { count } = await supabase
    .from('experiment_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('experiment_id', experimentId);

  console.log(`\n总代币数: ${count}`);
}

check().catch(console.error);