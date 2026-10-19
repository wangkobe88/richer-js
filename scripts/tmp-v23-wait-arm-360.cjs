#!/usr/bin/env node
// 一次性：v23 P4 底部等待臂缓冲 120s→360s（用户 2026-10-19 指令：
// 「跌到底了再等等」臂的缓冲延长；不增删腿，只改 condition 与 description）
// 用法：node scripts/tmp-v23-wait-arm-360.cjs [--commit]（不带 --commit 只读不写）
require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = 'b07fbe84-5051-4624-bd41-dcbef416e421';
const OLD_COND = 'marketCap > 0 AND marketCap < 3500 AND realHoldDuration > 120';
const NEW_COND = 'marketCap > 0 AND marketCap < 3500 AND realHoldDuration > 360';
const OLD_DESC = '市值清仓臂-3.5K底部等待（已跌到底再等等，有再起来先例，120s 缓冲）';
const NEW_DESC = '市值清仓臂-3.5K底部等待（已跌到底再等等，有再起来先例，360s 缓冲）';

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

  // 定位等待臂：marketCap < 3500 只在等待臂出现（快跑臂是 > 3500 AND < 4000）
  const hits = sells.map((l, i) => ({ i, l })).filter(x => (x.l.condition || '').includes('marketCap < 3500'));
  if (hits.length !== 1) throw new Error(`定位异常：marketCap < 3500 命中 ${hits.length} 条（期望 1）`);
  const { i: idx, l: leg } = hits[0];
  console.log(`\n[${idx}] 当前等待臂完整形状:`);
  console.log(JSON.stringify(leg, null, 2));
  if (leg.condition !== OLD_COND) throw new Error(`形状漂移：condition 不是预期的 120s 版本\n  实际: ${leg.condition}\n  预期: ${OLD_COND}`);

  if (!commit) { console.log('\n(dry-run，未写回。加 --commit 执行)'); return; }

  leg.condition = NEW_COND;
  if (leg.description === OLD_DESC) leg.description = NEW_DESC;
  else if (leg.description) throw new Error(`description 形状漂移: ${leg.description}`);

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
  if (vSells[idx].condition !== NEW_COND) throw new Error(`回读不符: ${vSells[idx].condition}`);
  console.log(`  [${idx}] ${vSells[idx].condition}`);
  console.log(`  [${idx}] ${vSells[idx].description}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
