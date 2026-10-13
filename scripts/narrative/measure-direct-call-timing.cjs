#!/usr/bin/env node
/**
 * 叙事直调耗时单 token 实测（N1 分段计时；2026-10-13 叙事提速案验证工具）
 *
 * 删 token_narrative 缓存行（标准失效手法，同 invalidate-*-window.cjs）后经
 * NarrativeDirectCaller 冷跑真析，输出 durationMs + N1 分段（timing 数组，降序）。
 * 用于新旧代码耗时对比 / 182 实跑验证（本地 .env 无 SILICONFLOW_FALLBACK_KEY，
 * vision 段会 fail-loud 中断——本地测需临时关 config/narrative-engine.json vision.enabled）。
 *
 * 用法：node scripts/narrative/measure-direct-call-timing.cjs <tokenAddress>
 * 注意：单行读写；外部 API 抓取耗时受运行机网络影响（本地 VPN 的 DB 段偏慢），
 * 结论须标注运行环境。
 */
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const { dbManager } = require('../../src/services/dbManager.js');
const { NarrativeDirectCaller } = require('../../src/trading-engine/pre-check/NarrativeDirectCaller.js');

async function main() {
  const tokenAddress = (process.argv[2] || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(tokenAddress)) {
    throw new Error('用法: node scripts/narrative/measure-direct-call-timing.cjs <tokenAddress>');
  }
  const supabase = dbManager.getClient();

  // 1) 查看并删除缓存行（删后由本次重析 upsert 回写）
  const { data: existing, error: selErr } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, is_valid, analyzed_at, prompt_version, prompt_type')
    .eq('token_address', tokenAddress);
  if (selErr) throw new Error(`缓存行查询失败: ${selErr.message}`);
  console.log('[cache-before]', JSON.stringify(existing));
  if (existing && existing.length > 0) {
    const { error: delErr } = await supabase
      .from('token_narrative')
      .delete()
      .eq('token_address', tokenAddress);
    if (delErr) throw new Error(`缓存行删除失败: ${delErr.message}`);
    console.log('[cache] 已删除缓存行 → 冷启动重析');
  } else {
    console.log('[cache] 无缓存行（本就冷）');
  }

  // 2) 直调计时（与引擎 fire 直调同参数形状：enrichSocialByGmgn + skipIntermediateSave）
  const caller = new NarrativeDirectCaller();
  const r = await caller.getRating(tokenAddress);

  console.log('\n=== 结果 ===');
  console.log(`rating=${r.numericRating}(${r.rating}) durationMs=${r.durationMs} fromCache=${r.fromCache}` +
    ` timedOut=${r.timedOut} error=${r.error || 'none'}`);
  console.log(`precheckStage=${r.precheckStage} corpusTs=${r.corpusTs}`);
  if (Array.isArray(r.timing)) {
    const sorted = [...r.timing].sort((a, b) => b.ms - a.ms);
    const total = sorted.reduce((s, x) => s + (x.ms || 0), 0);
    console.log(`\n=== N1 分段（${sorted.length} 段，合计 ${total.toFixed(0)}ms，降序）===`);
    for (const seg of sorted) {
      console.log(`  ${String(Math.round(seg.ms)).padStart(7)}ms  ${seg.seg}`);
    }
  } else {
    console.log('[timing] null（超时/异常，底层可能仍在后台跑）');
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
