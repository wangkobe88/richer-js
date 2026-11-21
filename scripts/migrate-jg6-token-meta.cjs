/**
 * 一次性数据修复（2026-11-21，bt-v171 token-returns 页 symbol=Unknown 排查产物）：
 * JG6-taildip豁免对拍 集合（6fd0372f-48eb-494d-890b-5fa652127609，2489 票）的
 * token_meta 是临时脚本（tmp-jg6-create-collection.cjs / tmp-jg6-expand-collection.cjs）
 * 写入的「归一化形状」（{address,symbol,name,...} 直铺），不满足 CaseCollectionService
 * .buildTokenMetaSnapshot 契约（{payload 原样, blockTimeIso, sourceEventId, platform}）——
 * BacktestEngine._loadTokenMetadataFromCaseSet 经 tokenMetaFromCreatePayload(meta.platform,
 * meta.payload||{}, meta.blockTimeIso) 取键全部落空 → symbol/name/creator 空（页面 Unknown）
 * + createdAtSec=null 回落首 tick 出生锚（与两装载通道契约口径不一致）。
 *
 * 修复：逐票从 wss_events token_create 重建正式快照形状——选行逻辑与正式链路
 * addToken 逐字节同构（count exact+无序 limit 对账、多行取最早 block_time、
 * CASE_PLATFORMS 校验、零行宁拒不漏），构造复用导出的 buildTokenMetaSnapshot。
 *
 * 幂等：已是正式形状（payload + blockTimeIso 键齐）的行跳过；只更新 token_meta
 * 键（platform/note/sync 水位一律不动）。miss 行 fail-loud 清单打印+退出码 1，
 * 不做合成兜底（对齐「宁拒不漏」纪律）。
 *
 * 182 跑（2489 票 × 点查+update ≈ 5000 往返，本地 VPN 必超时，红线 #9）。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const {
  buildTokenMetaSnapshot, CASE_PLATFORMS, SYNC_EVENT_LIMIT,
} = require('../src/web/services/CaseCollectionService');

const COLLECTION_ID = '6fd0372f-48eb-494d-890b-5fa652127609';
const PAGE = 500;

function isSnapshotShape(meta) {
  return !!(meta && meta.payload && ('blockTimeIso' in meta));
}

async function main() {
  const c = dbManager.getClient();

  const { count } = await c.from('case_collection_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', COLLECTION_ID);
  console.log(`集合 ${COLLECTION_ID} 成员数: ${count}`);

  const members = [];
  for (let from = 0; from < count; from += PAGE) {
    const { data: page } = await c.from('case_collection_tokens')
      .select('id, token_address, token_meta')
      .eq('collection_id', COLLECTION_ID)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!page || !page.length) break;
    members.push(...page);
    if (page.length < PAGE) break;
  }
  if (members.length !== count) {
    throw new Error(`成员对账失配（分页累计 ${members.length} ≠ count ${count}）`);
  }

  const stale = members.filter(m => !isSnapshotShape(m.token_meta));
  console.log(`旧形状待迁移: ${stale.length}；已是正式形状跳过: ${members.length - stale.length}`);

  let migrated = 0;
  const missed = [];
  for (let i = 0; i < stale.length; i++) {
    const m = stale[i];
    // 选行=与 addToken 同构：count exact + 无序 limit 对账，多行取最早 block_time
    const { data: rows, count: evCount, error } = await c.from('wss_events')
      .select('id, token_address, platform, payload, block_time', { count: 'exact' })
      .eq('kind', 'token_create')
      .eq('token_address', m.token_address)
      .limit(SYNC_EVENT_LIMIT);
    if (error) throw new Error(`查询 token_create 失败 ${m.token_address}: ${error.message}`);
    if (evCount != null && evCount > SYNC_EVENT_LIMIT) {
      throw new Error(`token_create 行 ${evCount} 超上限（数据形状异常，宁拒不漏）: ${m.token_address}`);
    }
    const list = rows || [];
    if (!list.length) { missed.push(m.token_address); continue; }
    let chosen = list[0];
    for (const row of list) {
      if (new Date(row.block_time).getTime() < new Date(chosen.block_time).getTime()) chosen = row;
    }
    if (!CASE_PLATFORMS.includes(chosen.platform)) {
      throw new Error(`token_create 行 platform 异常: ${chosen.platform}（${m.token_address}）`);
    }
    const { error: uErr } = await c.from('case_collection_tokens')
      .update({ token_meta: buildTokenMetaSnapshot(chosen) })
      .eq('collection_id', COLLECTION_ID)
      .eq('token_address', m.token_address);
    if (uErr) throw new Error(`更新失败 ${m.token_address}: ${uErr.message}`);
    migrated++;
    if (migrated % 200 === 0) console.log(`  …${migrated}/${stale.length}`);
  }

  console.log(`迁移完成: ${migrated}；miss（wss_events 无 token_create 行）: ${missed.length}`);
  for (const a of missed) console.log('  MISS:', a);
  if (missed.length > 0) process.exit(1);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
