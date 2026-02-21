const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const sourceExperimentId = '0c616581-aa7f-4fcf-beed-6c84488925fb';
  const PAGE_SIZE = 100;

  console.log('=== 测试完整分页查询逻辑 ===\n');

  let allData = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 100) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('id, loop_count, timestamp')
      .eq('experiment_id', sourceExperimentId)
      .order('timestamp', { ascending: true })
      .range(from, to);

    if (error) {
      console.log(`❌ 第 ${page + 1} 页查询失败: ${error.message}`);
      break;
    }

    console.log(`第 ${page + 1} 页 (range ${from}-${to}): 获取 ${data?.length || 0} 条`);

    if (data && data.length > 0) {
      allData = allData.concat(data);
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }

    page++;

    if (page % 20 === 0) {
      console.log(`📊 已获取 ${allData.length} 条数据...`);
    }
  }

  console.log(`\n✅ 总共获取 ${allData.length} 条数据`);
  console.log(`   共查询了 ${page} 页`);

  const loopCounts = [...new Set(allData.map(d => d.loop_count))];
  console.log(`   loop_count 范围: ${Math.min(...loopCounts)} - ${Math.max(...loopCounts)} (共 ${loopCounts.length} 个不同值)`);
})();
