import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: './config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { global: { timeout: 120000 } }
);

const orphans = [
  { id: '1beccc96-e666-48c1-a6c0-0b5f1cf61e43', count: 23759 },
  { id: '3a8e385c-d45d-4a82-8c22-ecbd33a48b9e', count: 23214 },
  { id: '6752791c-5bc7-4b87-a35a-0d5fbf01164d', count: 27176 },
  { id: '8be3f739-b0bf-4a7e-9d83-a0dc30cc45d6', count: 59038 }
];

async function deleteWithBatch() {
  for (const orphan of orphans) {
    const shortId = orphan.id.substring(0, 8) + '...';
    console.log(`\n[${orphans.indexOf(orphan) + 1}/${orphans.length}] 删除实验 ${shortId} (预计 ${orphan.count} 条)...`);

    // 先获取当前实际记录数
    const countResult = await supabase
      .from('experiment_time_series_data')
      .select('*', { count: 'exact', head: true })
      .eq('experiment_id', orphan.id);

    const actualCount = countResult.count || 0;
    console.log(`   实际记录数: ${actualCount}`);

    if (actualCount === 0) {
      console.log(`   ✅ 已清空`);
      continue;
    }

    // 使用 LIMIT 配合子查询方式分批删除
    const batchSize = 1000;
    let totalDeleted = 0;
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      attempts++;

      // 删除一批（使用 id 排序取前 N 条）
      const { data: toDelete } = await supabase
        .from('experiment_time_series_data')
        .select('id')
        .eq('experiment_id', orphan.id)
        .order('id', { ascending: true })
        .limit(batchSize);

      if (!toDelete || toDelete.length === 0) {
        console.log(`   ✅ 已清空`);
        break;
      }

      const idsToDelete = toDelete.map(r => r.id);

      // 使用 IN 删除这批数据
      const deleteResult = await supabase
        .from('experiment_time_series_data')
        .delete()
        .in('id', idsToDelete);

      if (deleteResult.error) {
        console.log(`   ❌ 批次 ${attempts} 失败: ${deleteResult.error.message}`);
        break;
      }

      totalDeleted += deleteResult.data?.length || idsToDelete.length;

      // 检查剩余
      const checkResult = await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', orphan.id);

      const remaining = checkResult.count || 0;
      console.log(`   批次 ${attempts}: 已删除 ${totalDeleted}/${actualCount}, 剩余 ${remaining}`);

      if (remaining === 0) {
        console.log(`   ✅ 完成`);
        break;
      }

      // 延迟避免超时
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

deleteWithBatch().catch(console.error);
