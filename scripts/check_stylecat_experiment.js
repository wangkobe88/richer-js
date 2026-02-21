require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 查询格调猫属于哪个实验
  const { data: styleCatData } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id, loop_count, timestamp')
    .eq('token_address', '0xdd657a8f9cbaf4a78d5bfc8da501dadfdb3d4444')
    .order('timestamp', { ascending: true })
    .limit(10);

  console.log('格调猫数据点:');
  if (styleCatData && styleCatData.length > 0) {
    styleCatData.forEach(d => {
      console.log(`  实验ID: ${d.experiment_id}, loop: ${d.loop_count}`);
    });
  }

  // 检查实验 0c616581 中格调猫的 loop 范围
  const { data: sourceData } = await supabase
    .from('experiment_time_series_data')
    .select('loop_count')
    .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
    .eq('token_address', '0xdd657a8f9cbaf4a78d5bfc8da501dadfdb3d4444')
    .order('loop_count', { ascending: true });

  if (sourceData && sourceData.length > 0) {
    const loops = sourceData.map(d => d.loop_count);
    console.log('\n实验 0c616581 中格调猫的 loop 范围:');
    console.log(`  ${Math.min(...loops)} - ${Math.max(...loops)}`);
    console.log(`  总数据点: ${sourceData.length}`);
  }

  // 检查所有包含格调猫的实验
  const { data: allExps } = await supabase
    .from('experiment_time_series_data')
    .select('experiment_id')
    .eq('token_address', '0xdd657a8f9cbaf4a78d5bfc8da501dadfdb3d4444');

  const uniqueExps = [...new Set(allExps?.map(d => d.experiment_id) || [])];
  console.log('\n包含格调猫的实验数量:', uniqueExps.length);
  uniqueExps.forEach(expId => {
    console.log('  ' + expId);
  });
})();
