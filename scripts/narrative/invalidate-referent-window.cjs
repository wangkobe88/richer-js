#!/usr/bin/env node
// ============================================================================
// J1.28 指代对象 meme 低档门——窗口级 token_narrative 缓存失效（2026-10-08）
//
// 背景：referent_memeability J1.28 起标准路径恒带（旧缓存行无此答案 →
// referentMemeabilityLowBlock 缺分不拦）。要让门在「历史窗口回测」里生效，必须
// 先把窗口 token 的叙事缓存行置 is_valid=false，重跑时 analyze() 缓存 miss →
// 重析（J1.28 题集 + mapper 门）。
//
// 失效范围（刻意收窄）：基底实验 strategy_signals(action='buy') 的 distinct
// token_address——回测叙事直调只发生在买腿 fire 之后（signal 行先落库再调
// analyze），signal 集合就是新跑会触碰的分析全集；不动全表（live 实验 6f92e2f9
// 只分析新票不受影响，其它窗口回测重跑不受影响）。
//
// 大小写：token_narrative 落库小写（NarrativeRepository.updateIsValid 同口径）；
// signals 的 token_address 大小写混合 → 统一 lower + 去重再匹配。
//
// 用法（182）：node scripts/narrative/invalidate-referent-window.cjs <基底实验ID> [--commit]
//   默认 dry-run 打印将失效行数；--commit 真更新（分块 100 .in()，批 100 地址）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const BASE_ID = args.find(a => !a.startsWith('--'));
if (!BASE_ID) {
  console.error('用法: node scripts/narrative/invalidate-referent-window.cjs <基底实验ID> [--commit]');
  process.exit(1);
}

const CHUNK = 100;

(async () => {
  const { dbManager } = require('../../src/services/dbManager');
  const client = dbManager.getClient(); // service key（RLS：anon 对 token_narrative 不可写）

  // 1) 基底实验买腿 signal 的 distinct token（分页拉全，上限 5000 防意外）
  const tokens = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await client.from('strategy_signals')
      .select('token_address')
      .eq('experiment_id', BASE_ID).eq('action', 'buy')
      .range(from, from + 999);
    if (error) throw new Error('signals: ' + error.message);
    for (const r of data) if (r.token_address) tokens.add(r.token_address.toLowerCase());
    if (data.length < 1000 || from >= 5000) break;
    from += 1000;
  }
  const addrs = [...tokens];
  console.log(`基底 ${BASE_ID} 买腿 signal distinct token: ${addrs.length}`);

  // 2) token_narrative 现存有效行计数（dry-run 信息 + commit 后核验）
  const countValid = async () => {
    let n = 0;
    for (let i = 0; i < addrs.length; i += CHUNK) {
      const { count, error } = await client.from('token_narrative')
        .select('id', { count: 'exact', head: true })
        .eq('is_valid', true).in('token_address', addrs.slice(i, i + CHUNK));
      if (error) throw new Error('count: ' + error.message);
      n += count ?? 0;
    }
    return n;
  };
  const before = await countValid();
  console.log(`token_narrative 窗口内 is_valid=true 行: ${before}`);

  if (!COMMIT) { console.log('[dry-run] 未更新；加 --commit 置 is_valid=false（重跑时懒重析 J1.28）'); process.exit(0); }

  let updated = 0;
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const chunk = addrs.slice(i, i + CHUNK);
    const { error } = await client.from('token_narrative')
      .update({ is_valid: false })
      .eq('is_valid', true).in('token_address', chunk);
    if (error) throw new Error('update: ' + error.message);
    updated += chunk.length;
    console.log(`  [${Math.min(i + CHUNK, addrs.length)}/${addrs.length}] 批更新提交`);
  }
  const after = await countValid();
  console.log(`\n完成：${addrs.length} 地址（${updated} 触达），窗口内有效行 ${before} → ${after}`);
  console.log('下一步：跑门臂回测（analyze 缓存 miss → J1.28 重析，低档门生效）');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
