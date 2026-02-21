require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  // 使用分页查询获取所有数据
  const PAGE_SIZE = 100;
  let allData = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 200) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('loop_count, timestamp')
      .eq('experiment_id', '0c616581-aa7f-4fcf-beed-6c84488925fb')
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (error) {
      console.log('Error:', error.message);
      break;
    }

    if (data && data.length > 0) {
      allData = allData.concat(data);
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }

    page++;
  }

  console.log('总计获取:', allData.length, '条数据');

  if (allData.length > 0) {
    const loops = allData.map(d => d.loop_count);
    console.log('loop 范围:', Math.min(...loops), '-', Math.max(...loops));

    // 检查是否有 loop 1166 的数据
    const hasLoop1166 = loops.includes(1166);
    console.log('包含 loop 1166:', hasLoop1166);

    // 检查 loop 1166 附近的数据
    const near1166 = allData.filter(d => d.loop_count >= 1160 && d.loop_count <= 1170);
    console.log('\nloop 1160-1170 的数据点数:', near1166.length);
    near1166.forEach(d => {
      console.log(`  loop ${d.loop_count}: ${new Date(d.timestamp).toLocaleString('zh-CN')}`);
    });
  }

  console.log('\n结论: 源实验有 18742 条数据，远超 1000 条限制');
  console.log('如果回测引擎只加载了前 1000 条，就无法处理到 loop 1166-1206 的"格调猫"数据');
})();
