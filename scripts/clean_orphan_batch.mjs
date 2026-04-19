/**
 * 分批删除孤儿时序数据（cursor-based 分页，避免 offset 超时）
 */

import dotenv from 'dotenv';
dotenv.config({ path: './config/.env' });

import { dbManager } from '../src/services/dbManager.js';

dbManager.setTimeout(180000);
const supabase = dbManager.getClient();

const BATCH_SIZE = 500;

async function getValidExperimentIds() {
  const ids = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('experiments')
      .select('id')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data.length) break;
    ids.push(...data.map(d => d.id));
    offset += 1000;
  }
  return ids;
}

async function getOrphanExperimentIds(validIds) {
  const validSet = new Set(validIds);
  const allIds = new Set();
  let cursor = 0;
  let scanned = 0;

  console.log('扫描时序数据中的 experiment_id（cursor 分页）...');
  while (true) {
    const { data, error } = await supabase
      .from('experiment_time_series_data')
      .select('id, experiment_id')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!data.length) break;

    data.forEach(d => allIds.add(d.experiment_id));
    cursor = data[data.length - 1].id;
    scanned += data.length;

    if (scanned % 50000 === 0) {
      console.log(`   已扫描 ${scanned} 条，发现 ${allIds.size} 个唯一实验...`);
    }
  }
  console.log(`   扫描完成，共 ${scanned} 条，${allIds.size} 个唯一实验`);

  return [...allIds].filter(id => !validSet.has(id));
}

async function batchDelete(expId) {
  const shortId = expId.substring(0, 8) + '...';
  let totalDeleted = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const { data: rows, error: selectError } = await supabase
      .from('experiment_time_series_data')
      .select('id')
      .eq('experiment_id', expId)
      .limit(BATCH_SIZE);

    if (selectError) throw selectError;
    if (!rows || !rows.length) break;

    const ids = rows.map(r => r.id);
    const { error: deleteError } = await supabase
      .from('experiment_time_series_data')
      .delete()
      .in('id', ids);

    if (deleteError) throw deleteError;

    totalDeleted += ids.length;
    console.log(`   第 ${batchNum} 批: ${ids.length} 条，累计 ${totalDeleted} 条`);
  }

  return totalDeleted;
}

async function main() {
  try {
    console.log('获取有效实验 ID...');
    const validIds = await getValidExperimentIds();
    console.log(`有效实验: ${validIds.length} 个\n`);

    console.log('查找孤儿实验...');
    const orphanIds = await getOrphanExperimentIds(validIds);
    console.log(`孤儿实验: ${orphanIds.length} 个\n`);

    if (!orphanIds.length) {
      console.log('没有孤儿数据');
      return;
    }

    for (let i = 0; i < orphanIds.length; i++) {
      const expId = orphanIds[i];
      const shortId = expId.substring(0, 8) + '...';
      console.log(`[${i + 1}/${orphanIds.length}] 删除实验 ${shortId}...`);
      const count = await batchDelete(expId);
      console.log(`   ✅ 完成，共删除 ${count} 条\n`);
    }

    console.log('🎉 全部清理完成！');
  } catch (err) {
    console.error('❌ 失败:', err.message);
    process.exit(1);
  } finally {
    dbManager.cleanup();
  }
}

main();
