#!/usr/bin/env node
/**
 * Case 集合同步 CLI（2026-11-20 Case 集合管理系统）——在 182 跑
 *
 * 为什么需要 CLI：web 只在本地跑（红线：182 禁止 web 服务），而 ticks 复制对
 * 大票是重查询（单票上万行）——本地 web 直连 Supabase 必超时（红线 #9 本地不
 * 走重查询）。web 页面的「同步/补拉」按钮适合本地小票/冒烟；真实同步走本脚本
 * 在 182 执行（复用 CaseCollectionService 复制执行器，水位幂等可续传）。
 *
 * 用法（182，项目目录）：
 *   node scripts/sync-case-collection.cjs --collection <名或uuid>            # 集合内全部 pending/failed
 *   node scripts/sync-case-collection.cjs --collection <名或uuid> --token 0x… # 单票同步/补拉增量
 *   node scripts/sync-case-collection.cjs --list                              # 列集合与同步状态
 *
 * 退出码：0=全部成功；1=参数/数据错误；2=部分票失败（清单见输出）。
 */

'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : null;
}

async function main() {
  const svc = new CaseCollectionService();
  const client = svc._client();

  if (process.argv.includes('--list')) {
    const list = await svc.list();
    if (!list.length) { console.log('（无集合）'); return; }
    for (const c of list) {
      console.log(`${c.name}  [${c.id}]  ${c.tokenCount} 票 / synced=${c.synced} pending=${c.pending} failed=${c.failed} syncing=${c.syncing} / ${c.tickTotal} ticks`);
    }
    return;
  }

  const collectionRef = arg('collection');
  const tokenAddr = arg('token');
  if (!collectionRef) {
    console.error('用法: node scripts/sync-case-collection.cjs --collection <名或uuid> [--token 0x…] | --list');
    process.exit(1);
  }

  // 集合解析（名或 uuid）
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collectionRef);
  const { data: col } = isUuid
    ? await client.from('case_collections').select('id, name').eq('id', collectionRef).maybeSingle()
    : await client.from('case_collections').select('id, name').eq('name', collectionRef).maybeSingle();
  if (!col) {
    console.error(`集合不存在: ${collectionRef}（--list 查看全部）`);
    process.exit(1);
  }

  // 目标票清单
  let targets;
  if (tokenAddr) {
    const addr = String(tokenAddr).toLowerCase();
    const { data: row } = await client.from('case_collection_tokens')
      .select('token_address, sync_state')
      .eq('collection_id', col.id).eq('token_address', addr).maybeSingle();
    if (!row) { console.error(`成员不存在: ${addr}`); process.exit(1); }
    targets = [row];
  } else {
    const { data: rows } = await client.from('case_collection_tokens')
      .select('token_address, sync_state')
      .eq('collection_id', col.id)
      .in('sync_state', ['pending', 'failed']);
    targets = rows || [];
  }
  if (!targets.length) {
    console.log(`集合「${col.name}」无待同步成员（全部 synced${tokenAddr ? ' 或该票已 synced' : ''}）。`);
    return;
  }

  console.log(`▶ 集合「${col.name}」待同步 ${targets.length} 票（串行执行，单票护栏 20 万行）`);
  const failed = [];
  let done = 0;
  for (const t of targets) {
    done++;
    process.stdout.write(`[${done}/${targets.length}] ${t.token_address}（${t.sync_state}）… `);
    try {
      await svc._syncToken(col.id, t.token_address);
      console.log('OK');
    } catch (err) {
      failed.push({ token: t.token_address, error: err.message });
      console.log('FAILED: ' + err.message);
    }
  }
  // 结果汇总（sync-status 真源）
  const status = await svc.syncStatus(col.id);
  console.log(`\n汇总: total=${status.summary.total} synced=${status.summary.synced} failed=${status.summary.failed} pending=${status.summary.pending}`);
  if (failed.length) {
    console.error(`\n${failed.length} 票失败（sync_error 已落库，水位保留可重跑续传）:`);
    for (const f of failed) console.error(`  ${f.token}: ${f.error}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('同步失败:', err.message);
  process.exit(1);
});
