#!/usr/bin/env node
// ============================================================================
// hg55 配对回测前置：新窗 token_narrative 叙事缓存失效（is_valid=false）
// （用户指令：R1 叙事重跑、R0 直接用 R1 结果）
//
// 范围 = 源实验 50442571 名下 discovered_at ∈ [10-02T02:18:18.992Z, 10-03T04:00Z]
// 的 token 全集（覆盖回测新窗可能触碰的全部 token）中已有 token_narrative 行的。
// 失效后：R1 触碰 → miss → 按 J1.27+C56（2c16d36）重析落回 true；
//         R0 命中 R1 落的缓存；R1 未触碰的 R0 触碰时 miss 就地重析（同代码）。
// narrative engine 常驻若并发重扫重析，同为 J1.27 口径，无害。
//
// 用法（182）：node scripts/invalidate-narrative-hg-window.cjs [--commit]
//   默认 dry-run 统计将失效行数 + prompt_version 分布；--commit 真失效。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC_ID = '50442571-967e-4537-875d-df7d0ceca01d';
const WIN_START = '2026-10-02T02:18:18.992Z';
const WIN_END = '2026-10-03T04:00:00.000Z';
const BATCH = 100;  // .in 走 GET，批 500 地址 URL ~21KB 会被拒（fetch failed），100 ≈ 4.3KB 安全

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

/** 网络/限流瞬断重试（3 次，2s 递增）——失败仍 throw fail-loud */
async function withRetry(fn, tag) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (e) { lastErr = e; }
    console.warn(`  [retry] ${tag} 第${i + 1}次失败: ${lastErr.message ?? lastErr}，${2 * (i + 1)}s 后重试`);
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  throw lastErr;
}

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // 1) 源实验新窗 token 全集（分页拉地址）
  const addrs = [];
  let from = 0;
  for (;;) {
    const { data, error } = await withRetry(() => db
      .from('experiment_tokens')
      .select('token_address')
      .eq('experiment_id', SRC_ID)
      .gte('discovered_at', WIN_START)
      .lte('discovered_at', WIN_END)
      .order('discovered_at', { ascending: true })
      .range(from, from + 999), '拉源token p' + from);
    if (error) throw new Error('拉源 token 失败: ' + error.message);
    for (const r of data || []) addrs.push(r.token_address);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log('源 ' + SRC_ID.slice(0, 8) + ' 新窗 token 全集:', addrs.length);

  // 2) 已有 token_narrative 行的（记录口径版本分布）
  const existing = [];
  for (let i = 0; i < addrs.length; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    const data = await withRetry(async () => {
      const res = await db
        .from('token_narrative')
        .select('token_address, prompt_type, prompt_version, is_valid')
        .in('token_address', batch);
      if (res.error) throw new Error('查 token_narrative: ' + res.error.message);  // error 对象也 throw，重试才能接住
      return res.data || [];
    }, '查narrative b' + i);
    existing.push(...data);
  }
  const byVer = {};
  for (const r of existing) {
    const k = (r.prompt_type || '?') + ' ' + (r.prompt_version || '?') + (r.is_valid ? ' valid' : ' invalid');
    byVer[k] = (byVer[k] || 0) + 1;
  }
  console.log('已有叙事行:', existing.length, '，口径分布:');
  for (const [k, c] of Object.entries(byVer).sort((a, b) => b[1] - a[1])) console.log('  ', k, ':', c);

  if (!existing.length) { console.log('无行可失效'); process.exit(0); }
  if (!COMMIT) { console.log('[dry-run] 未失效；加 --commit 真失效'); process.exit(0); }

  // 3) 批量 is_valid=false
  let done = 0;
  for (let i = 0; i < existing.length; i += BATCH) {
    const batch = existing.slice(i, i + BATCH).map(r => r.token_address);
    await withRetry(async () => {
      const res = await db
        .from('token_narrative')
        .update({ is_valid: false })
        .in('token_address', batch);
      if (res.error) throw new Error('失效: ' + res.error.message);
      return res;
    }, '失效批 ' + i);
    done += batch.length;
    process.stdout.write('\r失效进度: ' + done + '/' + existing.length);
  }
  console.log('\n✅ 失效完成:', done, '行 is_valid=false');

  // 4) 抽查复核
  const { data: chk } = await db
    .from('token_narrative')
    .select('token_address, is_valid')
    .in('token_address', existing.slice(0, 10).map(r => r.token_address));
  const bad = (chk || []).filter(r => r.is_valid !== false);
  console.log('抽查前 10 行:', bad.length === 0 ? '全部 false ✓' : '异常 ' + bad.length + ' 行');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
