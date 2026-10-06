#!/usr/bin/env node
/**
 * 规则5（high_influence_with_media）直发废除——存量直发行批量失效（182 跑）
 *
 * 背景（2026-10-06 NIGGALON 案 0xb62ec51d…7777，方案 A）：规则5曾对「高影响力
 * 账号/高交互 + 媒体」语料直发 mid（pass=true）短路整个 Jev 流程；现改为放行
 * 进 Jev（superIP fast-track / 标准路径）。存量直发行的 mid 是未经叙事判定的
 * 旧口径结果——批量置 is_valid=false，下次任何实验/回测遇同 token 走新口径
 * 重析（直调链路 miss 即重析，结果 upsert 回 is_valid=true，全局缓存语义）。
 *
 * 判定：pre_check_result->details->ruleName = 'high_influence_with_media'
 * （服务端 jsonb filter，与扫描脚本同口径；A 集 776 行，2026-10-06 实测）。
 *
 * 用法（182 上跑；重数据操作按准则不本地跑）：
 *   node scripts/narrative/invalidate-high-influence-media.cjs            # dry-run 清单+统计
 *   node scripts/narrative/invalidate-high-influence-media.cjs --commit   # 真正置 is_valid=false
 */
'use strict';

const PAGE = 1000;

async function main() {
  const doCommit = process.argv.includes('--commit');
  const { dbManager } = require('../../src/services/dbManager');
  const db = dbManager.getClient();

  // 全量拉规则5直发行（id 游标分页；is_valid 状态一并取，重复跑幂等）
  const rows = [];
  let cursor = 0;
  for (;;) {
    let q = db.from('token_narrative')
      .select('id,token_address,token_symbol,is_valid,created_at')
      .eq('pre_check_result->details->>ruleName', 'high_influence_with_media')
      .order('id', { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw new Error('查询失败: ' + error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }

  const validRows = rows.filter(r => r.is_valid);
  console.log(`规则5直发行: ${rows.length} 行，其中 is_valid=true 待失效 ${validRows.length} 行（已失效 ${rows.length - validRows.length} 行，幂等跳过）`);
  if (!validRows.length) { console.log('无可失效行，结束'); return; }
  console.log(`时间范围: ${rows[0].created_at} ~ ${rows[rows.length - 1].created_at}`);

  if (!doCommit) {
    console.log('\n[dry-run] 前 10 行示例:');
    for (const r of validRows.slice(0, 10)) console.log(`  ${r.token_symbol.padEnd(16)} ${r.token_address}`);
    console.log(`\n[dry-run] 共 ${validRows.length} 行将置 is_valid=false；加 --commit 真正执行`);
    return;
  }

  // 分批置 is_valid=false（updateIsValid 单条太慢；这里按地址批 in，100/批）
  const addrs = validRows.map(r => r.token_address);
  let done = 0;
  for (let i = 0; i < addrs.length; i += 100) {
    const batch = addrs.slice(i, i + 100);
    const { error } = await db.from('token_narrative').update({ is_valid: false }).in('token_address', batch);
    if (error) throw new Error(`批次 ${Math.floor(i / 100) + 1} 失败: ` + error.message);
    done += batch.length;
    process.stdout.write(`\r  已失效 ${done}/${addrs.length}`);
  }
  process.stdout.write('\n');
  console.log(`完成：${done} 行置 is_valid=false（数据保留，下次遇到同 token 自动重析走 Jev）`);
}

main().catch(e => { console.error(e); process.exit(1); });
