#!/usr/bin/env node
// 一次性：v23 P4 卖臂分段改造（3500-4000 快跑 10s / <3500 底部等待 120s）
// 用法：node scripts/tmp-v23-p4-split.cjs [--commit]（不带 --commit 只读不写）
require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = 'b07fbe84-5051-4624-bd41-dcbef416e421';

async function main() {
  const db = dbManager.getClient();
  const commit = process.argv.includes('--commit');

  const { data: row, error } = await db.from('experiments')
    .select('id, experiment_name, status, config')
    .eq('id', EXP_ID)
    .single();
  if (error) throw new Error(`读取实验失败: ${error.message}`);
  if (!row) throw new Error('实验不存在');

  const config = row.config;
  const sells = config.strategiesConfig.sellStrategies;
  console.log(`实验: ${row.experiment_name} (${row.id}) status=${row.status}`);
  console.log(`sellStrategies 共 ${sells.length} 条`);

  // 定位 P4 臂（当前形状 marketCap > 0 AND marketCap < 4000 AND realHoldDuration > 120）
  const p4Idx = sells.findIndex(l => (l.condition || '').includes('marketCap < 4000'));
  if (p4Idx < 0) throw new Error('未找到 P4 臂（marketCap < 4000）');
  const p4 = sells[p4Idx];
  console.log(`\n[${p4Idx}] 当前 P4 臂完整形状:`);
  console.log(JSON.stringify(p4, null, 2));

  if (!commit) { console.log('\n(dry-run，未写回。加 --commit 执行)'); return; }

  // 改造：P4 原位改快跑臂 (3500,4000)+10s；紧随其后插入底部等待臂 (0,3500)+120s
  const fastArm = JSON.parse(JSON.stringify(p4));
  fastArm.condition = 'marketCap > 3500 AND marketCap < 4000 AND realHoldDuration > 10';
  if (fastArm.description) fastArm.description = '市值清仓臂-3.5K~4K快跑（未跌到底赶紧跑，10s 缓冲）';

  const waitArm = JSON.parse(JSON.stringify(p4));
  waitArm.condition = 'marketCap > 0 AND marketCap < 3500 AND realHoldDuration > 120';
  if (waitArm.description) waitArm.description = '市值清仓臂-3.5K底部等待（已跌到底再等等，有再起来先例，120s 缓冲）';
  // 新腿复制同款参数形状：id/name 若存在则加后缀防撞
  if (waitArm.id !== undefined) waitArm.id = `${waitArm.id}-wait`;
  if (waitArm.name) waitArm.name = `${waitArm.name}-wait`;

  sells.splice(p4Idx, 1, fastArm, waitArm);
  console.log(`\n[${p4Idx}] 快跑臂: ${fastArm.condition}`);
  console.log(`[${p4Idx + 1}] 等待臂: ${waitArm.condition}`);

  const { error: updErr } = await db.from('experiments')
    .update({ config })  // eslint-disable-line
    .eq('id', EXP_ID);
  if (updErr) throw new Error(`写回失败: ${updErr.message}`);
  console.log('\n✅ 已写回 DB');

  // 回读核验
  const { data: verify, error: vErr } = await db.from('experiments')
    .select('config->strategiesConfig->sellStrategies')
    .eq('id', EXP_ID)
    .single();
  if (vErr) throw new Error(`回读失败: ${vErr.message}`);
  const vSells = verify['sellStrategies'];
  console.log(`回读核验: 共 ${vSells.length} 条`);
  [p4Idx, p4Idx + 1].forEach(i => console.log(`  [${i}] ${vSells[i].condition}`));
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
