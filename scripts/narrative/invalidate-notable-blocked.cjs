#!/usr/bin/env node
/**
 * C54/J1.26 notable_other 全域退出——存量「旧拦新放」行批量失效（182 跑）
 *
 * 背景：nameReferentBlock 阻断侧旧口径累计 minor+common+notable ≥0.5；J1.26 后
 * 只累计 minor+common。旧口径下被 name 门拦、且 notable 参与把质量抬过门槛的行
 * （minor+common < 0.5 ≤ +notable）在新口径下会翻案——批量置 is_valid=false，
 * 下次任何实验/回测遇同 token 走新口径重析（直调链路 miss 即重析，结果 upsert
 * 回 is_valid=true，全局缓存语义）。
 *
 * 判定（与新审计字段 nrNotableExempt 完全同口径，mapper 单一真相）：
 *   ① stage1（标准路径）/ prestage（superIP 通道）的概率里 name_referent 存在
 *   ② minor_other + common_word < 0.5 且 + notable_other ≥ 0.5（notable>0）
 *   ③ 行确实被 name 门拦（blockReason ∈ 三个 name 门标签——排除 pubProxy/J1.21
 *      豁免放行行与其他门拦截行）
 *
 * 用法（182 上跑；重数据操作按准则不本地跑）：
 *   node scripts/narrative/invalidate-notable-blocked.cjs            # dry-run 清单+统计
 *   node scripts/narrative/invalidate-notable-blocked.cjs --commit   # 真正置 is_valid=false
 *
 * 查询用 jsonb 窄列路径（不拉 stage1_prompt 60k 语料大字段）。
 */

'use strict';

const PAGE = 1000;
// name 门的三个 blockReason 标签（NAME_REFERENT_BLOCK_LABELS 值域；notable 标签
// J1.26 后已删，此处保留全三旧值——旧行 reason 展示的是旧标签）
const NR_BLOCK_LABELS = ['名字指向无名对象', '截词（非超级IP话中词）', '名字指向知名但非超级IP'];

function shapeOf(probs) {
  if (!probs || typeof probs !== 'object') return null;
  const minorCommon = (probs.minor_other ?? 0) + (probs.common_word ?? 0);
  const notable = probs.notable_other ?? 0;
  if (notable > 0 && minorCommon < 0.5 && minorCommon + notable >= 0.5) {
    return {
      minorCommon: Math.round(minorCommon * 100) / 100,
      notable: Math.round(notable * 100) / 100,
    };
  }
  return null;
}

async function main() {
  const doCommit = process.argv.includes('--commit');
  const { dbManager } = require('../../src/services/dbManager');
  const db = dbManager.getClient();

  // jsonb 窄列（五列契约：stageX_result = {…, details: parsed_output}，jev 内容在
  // details 下）：标准路径 name_referent 概率在 stage1.details.jev.probabilities
  // （stage2 的 probabilities 不含 name_referent）；superIP 通道在
  // prestage.details.jev.probabilities
  const SELECT = [
    'token_address',
    'token_symbol',
    'is_valid',
    'nr_probs:stage1_result->details->jev->probabilities->name_referent',
    's2_block:stage2_result->details->>blockReason',
    'ps_nr_probs:prestage_result->details->jev->probabilities->name_referent',
    'ps_block:prestage_result->details->>blockReason',
  ].join(',');

  const hits = [];
  let scanned = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('token_narrative')
      .select(SELECT)
      .order('token_address')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`查询失败(offset ${from}): ${error.message}`);
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const r of data) {
      // 标准路径：stage2 拦 + 概率形状；superIP 通道：prestage 拦 + 概率形状
      const stdShape = shapeOf(r.nr_probs);
      const psShape = shapeOf(r.ps_nr_probs);
      const stdBlocked = NR_BLOCK_LABELS.includes(r.s2_block);
      const psBlocked = NR_BLOCK_LABELS.includes(r.ps_block);
      const shape = stdShape && stdBlocked ? stdShape : (psShape && psBlocked ? psShape : null);
      if (shape && r.is_valid) {
        hits.push({ addr: r.token_address, symbol: r.token_symbol, ...shape, via: stdShape && stdBlocked ? 'stage2' : 'prestage' });
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`扫描 ${scanned} 行，命中「旧拦新放」形状且 is_valid=true：${hits.length} 行\n`);
  for (const h of hits) {
    console.log(`  ${h.symbol ?? '-'} ${h.addr} minorCommon=${h.minorCommon} notable=${h.notable} via=${h.via}`);
  }

  if (!doCommit) {
    console.log('\ndry-run：加 --commit 执行批量置 is_valid=false');
    return;
  }

  let invalidated = 0;
  for (let i = 0; i < hits.length; i += 200) {
    const chunk = hits.slice(i, i + 200).map(h => h.addr);
    const { error } = await db.from('token_narrative')
      .update({ is_valid: false })
      .in('token_address', chunk);
    if (error) throw new Error(`失效失败: ${error.message}`);
    invalidated += chunk.length;
  }
  console.log(`\n失效完成: ${invalidated} 行 → is_valid=false（下次遇同 token 直调链路自动重析，upsert 回 is_valid=true）`);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
