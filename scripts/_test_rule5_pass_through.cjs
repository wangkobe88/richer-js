#!/usr/bin/env node
/**
 * 规则5（high_influence_with_media）直发废除单测（2026-10-06 NIGGALON 案，方案 A）
 *
 * 改动语义：高影响力账号/高交互 + 媒体推文不再直发 mid，pre-check 放行
 * （返回 null）走 Jev 标准路径（superIP 注册表命中 → state 注入认证行，C83 起无快车道）。
 *
 * 零 DB 零网络：输入不携带 appendix/created_at/tokenCreatedAtSec（同名族与
 * 过期规则的触发前提全部缺失，天然跳过），twitterInfo 只带规则5所需字段。
 *
 * 节：
 *   A. 高影响力账号 + 媒体 → 放行（null）+ 无规则5日志
 *   B. 高交互腿（非名单账号 赞>5000）+ 媒体 → 同样放行
 *   C. 无媒体的高影响力推文 → 不触发规则5（null，与旧行为一致）
 *   D. 其他规则不受影响：symbol_too_long 仍拦截（管线有效性对照）
 *   E. 放行后 registry 覆盖存在：super-ip-registry 覆盖直发盲区头部账号（C83 起=state 注入）
 *   F. 源码口径：规则5骨架整块不存在（C86 死代码清理升级——2026-10-06 废除时
 *      保留了放行骨架+日志，C86 review 确认 twitterUrl 产出链已死（0.6 duplicateNarrative
 *      整链删除）后骨架删除；行为断言 A-D 保留=防直发复活）
 */
'use strict';

const assert = require('assert');

// 静音业务日志，捕获放行标记
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

async function main() {
  const { performPreCheck } = await import('../src/narrative/analyzer/services/pre-check-service.mjs');

  // ── 构造：只满足规则5前提，其余规则的触发字段全部缺失 ──
  // classifiedUrls 带 twitter 条目（真实链路必有；缺了会落规则4 no_public_info）
  // author_followers_count 必带：真实 apidance 链路恒有该字段，缺了会被
  // classifyTweetType 按 0 粉落 angle_seeking → 找角度语言门（2026-10-15）误拦
  const baseUrls = { twitter: [{ url: 'https://x.com/elonmusk/status/1', type: 'tweet', platform: 'twitter', priority: 1 }] };
  const baseToken = { symbol: 'NIGGALON', name: 'niggalon', address: '0xb62e'.padEnd(42, '0'), raw_api_data: {} };
  const mediaTw = (over = {}) => ({
    type: 'tweet',
    author_screen_name: 'elonmusk',
    author_followers_count: 150000000,
    text: 'RT @AlyssaSolen: Stop the Model.',
    media: { has_media: true, images: [{ url: 'https://x/y.jpg' }], videos: [] },
    metrics: { retweet_count: 243, like_count: null },
    ...over,
  });

  // A. 名单账号 + 媒体 → 放行
  {
    logs.length = 0;
    const r = await performPreCheck(baseToken, mediaTw(), {}, null, baseUrls, {}, null, null);
    assert.strictEqual(r, null, 'A1: 名单账号+媒体应放行返回 null（不再直发 mid）');
    assert.ok(!logs.some(l => l.includes('规则5')), 'A2: 规则5骨架已删（C86），不应再有规则5日志: ' + logs.join('|'));
    assert.ok(!logs.some(l => l.includes('给mid')), 'A3: 不应再有「给mid」直发日志');
    origLog('  A. 名单账号+媒体放行 ✓');
  }

  // B. 高交互腿（非名单账号，赞>5000）→ 同样放行
  {
    logs.length = 0;
    const r = await performPreCheck(baseToken, mediaTw({
      author_screen_name: 'random_guy',
      author_followers_count: 8000,
      metrics: { like_count: 8000, retweet_count: 100 },
    }), {}, null, baseUrls, {}, null, null);
    assert.strictEqual(r, null, 'B1: 高交互+媒体应放行（原同样直发 mid，随规则整体废除）');
    assert.ok(!logs.some(l => l.includes('规则5')), 'B2: 规则5骨架已删（C86），高交互腿零规则5日志');
    origLog('  B. 高交互腿放行 ✓');
  }

  // C. 无媒体 → 规则5不触发（continue），返回 null
  {
    logs.length = 0;
    const r = await performPreCheck(baseToken, {
      type: 'tweet', author_screen_name: 'elonmusk', author_followers_count: 150000000,
      text: 'plain text no media',
      media: { has_media: false, images: [], videos: [] },
      metrics: { like_count: 10, retweet_count: 2 },
    }, {}, null, baseUrls, {}, null, null);
    assert.strictEqual(r, null, 'C1: 无媒体不触发规则5');
    assert.ok(!logs.some(l => l.includes('规则5')), 'C2: 不应有规则5日志');
    origLog('  C. 无媒体不触发 ✓');
  }

  // D. 对照：其他 pre-check 规则不受本次改动影响（symbol 超长仍拦）
  {
    const r = await performPreCheck({ ...baseToken, symbol: 'THIS IS A VERY LONG SYMBOL WITH MANY WORDS YES' }, mediaTw(), {}, null, baseUrls, {}, null, null);
    assert.ok(r && r.rating === 'low' && r.details?.ruleName === 'symbol_too_long', 'D1: symbol_too_long 仍拦截');
    origLog('  D. symbol_too_long 不受影响 ✓');
  }

  // E. 放行后 registry 覆盖：头部账号命中进 state 认证行（C83 起无快车道）
  {
    const { detectSuperIP } = await import('../src/narrative/analyzer/prompts/super-ip/super-ip-registry.mjs');
    for (const [handle, note] of [
      ['elonmusk', 'NIGGALON 案语料作者'],
      ['cz_binance', 'Soon... 簇 ×14'],
      ['binance', '复蹭最大簇 410 票'],
      ['heyibinance', '31 票'],
    ]) {
      const hit = detectSuperIP(`https://x.com/${handle}/status/123`, null);
      assert.ok(hit && hit.tier === 'S', `E: @${handle}（${note}）应在 superIP registry（C83 起=state 认证行注入）`);
    }
    origLog('  E. superIP registry 覆盖头部账号 ✓');
  }

  // F. 源码口径：规则5骨架整块不存在（C86 死代码清理后防复活直发）
  {
    const fs = require('fs');
    const src = fs.readFileSync('src/narrative/analyzer/services/pre-check-service.mjs', 'utf8');
    assert.ok(!src.includes('[新逻辑 v2]'), 'F1: [新逻辑 v2] 规则5骨架应已删除（C86）');
    assert.ok(!src.includes('high_influence_with_media'), 'F2: 规则5标识符应已删除');
    assert.ok(!src.includes('规则5放行'), 'F3: 规则5放行日志锚点应已删除');
    origLog('  F. 源码口径（骨架整块不存在）✓');
  }

  origLog('\n全部通过：A 放行 / B 高交互腿 / C 无媒体不触发 / D 他规则不变 / E registry 覆盖（state 注入）/ F 骨架整块删除防复活');
}

main().then(() => process.exit(0)).catch(e => { origLog('\nFAIL:', e.message); process.exit(1); });
