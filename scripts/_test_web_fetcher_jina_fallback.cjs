#!/usr/bin/env node
/**
 * C41 web-fetcher r.jina.ai 回退——本地零 DB 零网络单测（2026-10-01 用户裁定 A，
 * RedCoin 案 0xe2881a7ac454c473a8b4c858732402154e107777：SCMP 有 Cloudflare JS
 * 挑战直抓 403 → web-fetcher null → pre-check rule 4 public_info_fetch_failed
 * 误拦真事件票）
 *
 * 机制：主抓失败（403/异常/内容提取 <50 字）时回退 https://r.jina.ai/<原URL>
 * 一次（免 key，实测直通 Cloudflare 站点）；解析 Title/Published Time/Markdown
 * Content，Published Time 仿 twitter-section 模式拼进 content 头部；返回形状
 * 与 _fetchDirect 同构（下游 websiteInfo/hasValidDataForAnalysis 零改动）+
 * fetchedVia 审计字段。回退也失败 → null（fail-closed 与旧行为等价）。
 *
 * 覆盖：
 *   A. parseJinaReaderOutput 纯函数矩阵（标准格式/无时间行/无头格式/空输入/
 *      正文内 "Title:" 行不误吞）
 *   B. 主抓成功不走回退（fetch 单次调用 + 无 fetchedVia）
 *   C. 主抓 403 → jina 回退成功（URL 拼接/形状/发布时间前缀）
 *   D. 回退也失败（jina 403 / 内容 <50 字 / 挑战页穿透）→ null
 *   E. 主抓 200 但空壳页（内容提取失败）→ 走回退
 *   F. 源码接线（JINA_READER_BASE / fetchedVia / 回退链）
 *
 * 用法：node scripts/_test_web_fetcher_jina_fallback.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

/** 手工 Response 桩（代码只消费 ok/status/text） */
function res(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const REAL_HTML = '<html><body><p>' + 'HSBC unveils RedCoin as name of Hong Kong stablecoin for 3.3 million PayMe users. '.repeat(3) + '</p></body></html>';

const JINA_BODY = [
  'Title: HSBC unveils RedCoin as name of Hong Kong stablecoin for 3.3 million PayMe users',
  'URL Source: https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin',
  'Published Time: 2026-09-30T12:18:24+08:00',
  'Markdown Content:',
  '## HSBC unveils RedCoin as name of Hong Kong stablecoin for 3.3 million PayMe users',
  '',
  'HSBC has unveiled RedCoin as the name of its Hong Kong dollar-pegged stablecoin, which will be integrated into its PayMe app used by 3.3 million residents before the end of the year.',
].join('\n');

async function main() {
  const wf = await import('../src/narrative/utils/web-fetcher.mjs');
  const { parseJinaReaderOutput, _fetchWebsiteContentInternal } = wf;

  const realFetch = globalThis.fetch;
  const calls = [];
  const stubFetch = (impl) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return impl(url, calls.length);
    };
  };
  const restoreFetch = () => { globalThis.fetch = realFetch; calls.length = 0; };

  console.log('\n── A. parseJinaReaderOutput 纯函数矩阵 ──');

  const p1 = parseJinaReaderOutput(JINA_BODY);
  check('A1 标准格式：Title/URL Source/Published Time/正文各自解析',
    p1?.title === 'HSBC unveils RedCoin as name of Hong Kong stablecoin for 3.3 million PayMe users'
      && p1?.urlSource === 'https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin'
      && p1?.publishedTime === '2026-09-30T12:18:24+08:00'
      && p1?.content.startsWith('## HSBC unveils RedCoin'),
    { title: p1?.title, publishedTime: p1?.publishedTime, contentHead: p1?.content?.slice(0, 30) });

  const p2 = parseJinaReaderOutput(['Title: T', 'URL Source: https://x.com/a', 'Markdown Content:', 'body text here'].join('\n'));
  check('A2 无 Published Time 行：publishedTime null、正文正常',
    p2?.publishedTime === null && p2?.content === 'body text here', p2);

  const p3 = parseJinaReaderOutput('直接吐正文没有任何标准头格式的内容超过五十个字符的场合返回整体当正文处理掉');
  check('A3 无标准头：整体当正文、头部字段全 null',
    p3?.title === null && p3?.urlSource === null && p3?.publishedTime === null && p3?.content.includes('直接吐正文'),
    p3);

  check('A4 空输入：null', parseJinaReaderOutput('') === null && parseJinaReaderOutput(null) === null);

  const p5 = parseJinaReaderOutput(['URL Source: https://x.com/a', 'Markdown Content:', 'Title: 正文里的行不该被吞掉 '.repeat(3)].join('\n'));
  check('A5 正文内 "Title:" 行保留在 content（头解析止于 Markdown Content:）',
    p5?.title === null && p5?.content.includes('Title: 正文里的行不该被吞掉'), p5);

  console.log('\n── B. 主抓成功不走回退 ──');

  stubFetch(() => res(200, REAL_HTML));
  const b = await _fetchWebsiteContentInternal('https://example.com/article');
  check('B1 主抓 200 有效内容：fetch 只调一次（无回退请求）', calls.length === 1, calls.map(c => c.url));
  check('B2 返回无 fetchedVia（直抓语义）', b?.fetchedVia === undefined && b?.content?.length > 50, b?.fetchedVia);
  restoreFetch();

  console.log('\n── C. 主抓 403 → jina 回退成功 ──');

  stubFetch((url, n) => {
    if (n === 1) return res(403, 'Forbidden');
    return res(200, JINA_BODY);
  });
  const c = await _fetchWebsiteContentInternal('https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin');
  check('C1 两次请求：原URL → r.jina.ai/<原URL>',
    calls.length === 2 && calls[0].url === 'https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin'
      && calls[1].url === 'https://r.jina.ai/https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin',
    calls.map(x => x.url));
  check('C2 形状同构：type/url/original_length + fetchedVia 审计',
    c?.type === 'website' && c?.url === 'https://www.scmp.com/news/hong-kong/article/3300000/hsbc-unveils-redcoin'
      && typeof c?.original_length === 'number' && c?.fetchedVia === 'r.jina.ai',
    { type: c?.type, fetchedVia: c?.fetchedVia });
  check('C3 Published Time 拼进 content 头部（Jev timing 题时间信息）',
    c?.content?.startsWith('[发布时间: 2026-09-30T12:18:24+08:00]\n') && c?.publishedTime === '2026-09-30T12:18:24+08:00',
    c?.content?.slice(0, 60));
  check('C4 title 字段携带', c?.title?.includes('HSBC unveils RedCoin'), c?.title);
  restoreFetch();

  console.log('\n── D. 回退也失败 → null（fail-closed 等价旧行为） ──');

  stubFetch((url, n) => n === 1 ? res(403, 'Forbidden') : res(429, 'rate limited'));
  const d1 = await _fetchWebsiteContentInternal('https://example.com/a');
  check('D1 jina 429 → null', d1 === null, d1);
  restoreFetch();

  stubFetch((url, n) => n === 1 ? res(403, 'x') : res(200, 'Title: T\nMarkdown Content:\nshort'));
  const d2 = await _fetchWebsiteContentInternal('https://example.com/b');
  check('D2 jina 内容 <50 字 → null', d2 === null, d2);
  restoreFetch();

  stubFetch((url, n) => n === 1 ? res(403, 'x') : res(200, 'Title: T\nMarkdown Content:\nJust a moment...\nEnable JavaScript and cookies to continue' + 'x'.repeat(60)));
  const d3 = await _fetchWebsiteContentInternal('https://example.com/c');
  check('D3 挑战页穿透（Just a moment…）→ null', d3 === null, d3);
  restoreFetch();

  console.log('\n── E. 主抓 200 但空壳页（提取失败）→ 走回退 ──');

  stubFetch((url, n) => n === 1 ? res(200, '<html><body><div id="app"></div></body></html>') : res(200, JINA_BODY));
  const e = await _fetchWebsiteContentInternal('https://example.com/js-shell-page');
  check('E1 空壳 JS 页主抓无内容 → jina 回退接管（fetchedVia 命中）',
    calls.length === 2 && e?.fetchedVia === 'r.jina.ai' && e?.content?.length > 50,
    { calls: calls.length, fetchedVia: e?.fetchedVia });
  restoreFetch();

  console.log('\n── F. 源码接线 ──');

  const fs = require('fs');
  const src = fs.readFileSync('src/narrative/utils/web-fetcher.mjs', 'utf8');
  check('F1 JINA_READER_BASE 常量 + 回退函数 + fetchedVia 审计字段',
    /const JINA_READER_BASE = 'https:\/\/r\.jina\.ai\/'/.test(src)
      && /_fetchViaJinaReader/.test(src) && /fetchedVia: 'r\.jina\.ai'/.test(src));
  check('F2 主函数 = direct → jina 回退链（主抓成功短路）',
    /const direct = await _fetchDirect\(url, options\);\s*\n\s*if \(direct\) return direct;\s*\n\s*return _fetchViaJinaReader\(url, options\);/.test(src));
  check('F3 parseJinaReaderOutput 导出（单测/复用入口）', typeof parseJinaReaderOutput === 'function');
  const directSeg = src.slice(src.indexOf('async function _fetchDirect'), src.indexOf('const JINA_READER_BASE'));
  check('F4 仅失败回退：主抓成功路径零 jina 请求（B1 已证，此处源码层——_fetchDirect 内无 jina 调用）',
    directSeg.length > 0 && !/JINA_READER_BASE|_fetchViaJinaReader/.test(directSeg));

  console.log(`\n═══════ ${passed} passed, ${failed} failed ═════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); });
