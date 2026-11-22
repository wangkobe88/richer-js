#!/usr/bin/env node
// 一次性：修「JG6-taildip豁免对拍」集合（6fd0372f）token_meta 形状——tmp-jg6-create-collection.cjs
// 写入的是扁平形状（{address,symbol,createdAt,creatorAddress,...} 平铺），而回测装载器
// _loadTokenMetadataFromCaseSet 只认官方契约 {payload, blockTimeIso, platform}（CaseCollectionService
// .buildTokenMetaSnapshot 产物）→ payload||{} = {} → symbol/name/creator 全空 + createdAtSec=null
// 回退首 tick。修复=按官方 addToken 同口径从 wss_events token_create 最早行重建（本脚本只动
// token_meta，不碰 sync_state/水位）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildTokenMetaSnapshot, CASE_PLATFORMS, SYNC_EVENT_LIMIT } = require('../src/web/services/CaseCollectionService');
const { tokenMetaFromCreatePayload } = require('../src/trading-engine/core/token-create-meta');

const COLLECTION_ID = '6fd0372f-48eb-494d-890b-5fa652127609';
const DRY = process.argv.includes('--dry');

(async () => {
  const sb = dbManager.getClient();
  const { data: members, error } = await sb.from('case_collection_tokens')
    .select('id, token_address, platform, token_meta')
    .eq('collection_id', COLLECTION_ID)
    .order('added_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  // 只修形状错误的行：token_meta 缺 payload 键（官方形状恒有 payload，可能为 {} 但键在）
  const broken = members.filter(m => !m.token_meta || m.token_meta.payload === undefined);
  console.log(`成员 ${members.length} 行，形状异常 ${broken.length} 行${DRY ? '（--dry 不写）' : ''}`);
  if (!broken.length) { console.log('无需修复'); process.exit(0); }

  let repaired = 0, symbolMiss = 0, creatorMiss = 0, createdAtMiss = 0, symbolChanged = 0;
  for (const m of broken) {
    // 官方 addToken 同口径：token_create 无序 limit + count 对账，多行取最早 block_time
    const { data: rows, count, error: evErr } = await sb.from('wss_events')
      .select('id, token_address, platform, payload, block_time', { count: 'exact' })
      .eq('kind', 'token_create')
      .eq('token_address', m.token_address)
      .limit(SYNC_EVENT_LIMIT);
    if (evErr) throw new Error(`${m.token_address}: ${evErr.message}`);
    if (count != null && count > SYNC_EVENT_LIMIT) throw new Error(`${m.token_address}: token_create 行 ${count} 超上限，宁拒不漏`);
    const list = rows || [];
    if (!list.length) throw new Error(`${m.token_address}: wss_events 无 token_create 行（数据源缺失，人工裁定）`);
    let chosen = list[0];
    for (const row of list) {
      if (new Date(row.block_time).getTime() < new Date(chosen.block_time).getTime()) chosen = row;
    }
    if (!CASE_PLATFORMS.includes(chosen.platform)) throw new Error(`${m.token_address}: platform 异常 ${chosen.platform}`);

    const meta = buildTokenMetaSnapshot(chosen);
    // 装载侧同款映射预验：七键必须恢复（symbol 非空/creator 非空/createdAtSec 非空）
    const seven = tokenMetaFromCreatePayload(meta.platform || chosen.platform, meta.payload, meta.blockTimeIso);
    if (!seven.symbol) symbolMiss++;
    if (!seven.creator) creatorMiss++;
    if (seven.createdAtSec == null) createdAtMiss++;
    if (m.token_meta?.symbol && seven.symbol !== m.token_meta.symbol) {
      symbolChanged++;
      console.log(`  ⚠️ symbol 变更 ${m.token_address}: FLAT「${m.token_meta.symbol}」→ 事件「${seven.symbol}」`);
    }

    if (!DRY) {
      const { error: upErr } = await sb.from('case_collection_tokens')
        .update({ token_meta: meta })
        .eq('collection_id', COLLECTION_ID)
        .eq('token_address', m.token_address);
      if (upErr) throw new Error(`${m.token_address}: ${upErr.message}`);
    }
    repaired++;
  }
  console.log(`${DRY ? '[dry] 应修复' : '已修复'} ${repaired} 行`);
  console.log(`七键预验（装载侧同款映射）: symbol 缺 ${symbolMiss} / creator 缺 ${creatorMiss} / createdAt 缺 ${createdAtMiss} / symbol 与旧 FLAT 值不同 ${symbolChanged}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
