#!/usr/bin/env node
/**
 * C164/P1.14 项目币官网核验单测（零 DB 零网络）
 *
 * 用户裁定（2026-10-22，一次性专号 rug 家族案 FOURGE 0xf9de0ca25d667c7dedbc1765bb05680a1828ffff /
 * SL 0x58417f3f9ac500ee40a3882119cbb8a4686affff）：原生项目币（prestage
 * addressVerified=true 且 token_type=project）必须看网站+检查叙事，没问题才能给过。
 * 两项配套裁定：①网站抓不到=拦（fail-closed——fetchWebsiteContent 失败缓存 null
 * sticky，重析同形状照拦）②无官网仅「基础设施/平台类宣称」拦（launchpad/交易平台/
 * 工具平台/数据服务——无站=无产品），其它类型无站不拦。
 *
 * 分层：代码端事实（resolveWebsiteCheck：有没有站/抓没抓到）→ state PRECOMPUTED
 * website_check 行 → Jev 内容判定（prestage_website_check 题，五选）→ mapper 门
 * （project 分支唯一拦截位）。题面改锚分不动，mapper 是拦截权威。
 *
 * 用法：node scripts/_test_prestage_website_check.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${desc}`); }
  else { failed++; console.error(`  ✗ ${desc}\n      期望: ${e}\n      实际: ${a}`); }
}

(async () => {
  const { mapPrestageAnswers } = await import('../src/narrative/analyzer/llm/jev-prestage-mapper.mjs');
  const { buildPrestageQuestions, JEV_PRESTAGE_QUESTIONS_VERSION } = await import('../src/narrative/analyzer/llm/jev-prestage-questions.mjs');
  const { buildPrestageState } = await import('../src/narrative/analyzer/llm/jev-state-builder.mjs');
  const { resolveWebsiteCheck } = await import('../src/narrative/analyzer/services/account-analysis-service.mjs');
  const fs = await import('node:fs');

  const callInfo = {
    model: 'test', questions: { q1: { type: 'choice' } }, stateStats: { totalChars: 10 },
    state: 'test-state', usage: {}, startedAt: '2026-10-22T00:00:00Z', finishedAt: '2026-10-22T00:00:01Z',
  };
  const account = (over = {}) => ({
    type: 'account', screen_name: 'fourge', followers_count: 100, statuses_count: 2,
    created_at: '2026-10-21T00:00:00Z', ...over,
  });
  const ctx = (data, over = {}) => ({
    fullAccountOrCommunityData: data, addressVerified: true, rulesResult: null,
    callInfo, ...over,
  });
  const wc = (choice) => ({ choice, probabilities: { [choice]: 0.9 } });
  // FOURGE 现场形状：project 0.9 + 官网核验答案（默认 pass 臂，逐 case 覆盖）
  const answers = (websiteChoice, over = {}) => ({
    prestage_token_type: { choice: 'project', probabilities: { project: 0.9 } },
    prestage_abm_name_link: { choice: 'exact', probabilities: { exact: 0.9 } },
    prestage_abm_web3_traffic: { choice: 'has_traffic', probabilities: { has_traffic: 0.8 } },
    prestage_website_check: wc(websiteChoice),
    ...over,
  });

  console.log('== 0. 版本与题面 ==');
  check('版本 bump P1.13→P1.14', JEV_PRESTAGE_QUESTIONS_VERSION, 'P1.14');
  const qs = buildPrestageQuestions();
  check('问题集 4 题（P1.14 加官网核验）', Object.keys(qs).length, 4);
  check('prestage_website_check 在题集', 'prestage_website_check' in qs, true);
  check('五选项齐（两 pass 臂 + 三拦臂）', Object.keys(qs.prestage_website_check.criteria).sort(),
    ['no_website_infra_claim', 'no_website_non_infra', 'website_shell_or_mismatch', 'website_substantiates', 'website_unreachable'].sort());

  console.log('== 1. mapper 门（project 分支五臂 + 异常臂） ==');
  const sub = mapPrestageAnswers(answers('website_substantiates'), ctx(account({ followers_count: 500 })));
  check('substantiates → 粉丝带照常（500 粉 high）', { t: sub.tokenType, r: sub.rating }, { t: 'project', r: 'high' });
  check('reason 附官网核验结论', sub.reasoning.includes('官网核验：官网核验通过'), true);
  const nonInfra = mapPrestageAnswers(answers('no_website_non_infra'), ctx(account()));
  check('non_infra → 粉丝带照常（100 粉 mid）', nonInfra.rating, 'mid');
  for (const [choice, kw] of [
    ['website_shell_or_mismatch', '网站空壳/与宣告叙事不符'],
    ['website_unreachable', '官网抓取失败'],
    ['no_website_infra_claim', '基础设施/平台类宣称但无官网'],
  ]) {
    const blocked = mapPrestageAnswers(answers(choice), ctx(account({ followers_count: 500 })));
    check(`${choice} → low（500 粉也不放行）`, { t: blocked.tokenType, r: blocked.rating }, { t: 'project', r: 'low' });
    check(`${choice} reason 含拦截归因关键词「${kw}」`, blocked.reasoning.includes(kw), true);
    check(`${choice} reason 含 C164 与原粉丝带（可复算）`, blocked.reasoning.includes('C164') && blocked.reasoning.includes('原粉丝带'), true);
    check(`${choice} 归因键 details.websiteCheck`, blocked.prestageDataToSave.parsed_output.details.websiteCheck, choice);
  }
  // 事故反证形状：答案不在五选项内（模型输出漂移/键改名）→ fail-closed 拦，不静默放行
  const bogus = mapPrestageAnswers(answers('hacked_choice'), ctx(account({ followers_count: 500 })));
  check('答案异常值 → low fail-closed', bogus.rating, 'low');
  check('异常 reason 带原值可见', bogus.reasoning.includes('答案异常:hacked_choice'), true);
  const p = mapPrestageAnswers(answers('website_unreachable'), ctx(account())).prestageDataToSave.parsed_output.jev.probabilities;
  check('parsed_output.jev.probabilities 含 prestage_website_check（审计）', !!p.prestage_website_check, true);

  console.log('== 2. 不消费面（abm/web3ip/推文语料改道） ==');
  const abm = mapPrestageAnswers(answers('website_unreachable', { prestage_token_type: { choice: 'project', probabilities: { project: 0.9 } } }),
    ctx(account(), { addressVerified: false }));
  check('addressVerified=false 不消费（abm 双过 → mid）', { t: abm.tokenType, r: abm.rating }, { t: 'account_based_meme', r: 'mid' });
  const web3ip = mapPrestageAnswers(answers('website_unreachable', { prestage_token_type: { choice: 'web3_native_ip_early', probabilities: { web3_native_ip_early: 0.9 } } }), ctx(account()));
  check('web3ip 不消费（粉丝带 mid 照常）', { t: web3ip.tokenType, r: web3ip.rating }, { t: 'web3_native_ip_early', r: 'mid' });
  const redirected = mapPrestageAnswers(answers('website_unreachable', { prestage_token_type: { choice: 'web3_native_ip_early', probabilities: { web3_native_ip_early: 0.9 } } }),
    ctx(account(), { corpusType: 'tweet' }));
  check('C101 推文语料改道不受门影响（abm 通道照常）', redirected.tokenType, 'account_based_meme');

  console.log('== 3. state-builder（website_check 状态行 + 网页内容段） ==');
  const tokenData = { symbol: 'FOURGE', name: 'FOURGE', address: '0xf9de0ca2', raw_api_data: {} };
  const data = account({ tweets: [{ created_at: '2026-10-21T17:30:00Z', text: 'launch $FOURGE CA: 0xf9de0ca2…' }] });
  const st = (websiteCheck, over = {}) => buildPrestageState(tokenData, data, {
    addressVerified: true, websiteCheck, ...over,
  }).state;
  const reachableState = st({ status: 'reachable', url: 'https://fourge.fun/', info: { url: 'https://fourge.fun/', content: 'FOURGE launchpad — create tokens on BSC' } });
  check('reachable → website_check 状态行', reachableState.includes('website_check: reachable（官方网站 https://fourge.fun/ 抓取成功'), true);
  check('reachable → 【网页内容】段', reachableState.includes('【网页内容】'), true);
  const unreachableState = st({ status: 'unreachable', url: 'https://fourge.fun/' });
  check('unreachable → 状态行（死链≠没提供站）', unreachableState.includes('website_check: unreachable') && unreachableState.includes('死链不等于没提供站'), true);
  check('unreachable → 无网页内容段', unreachableState.includes('【网页内容】'), false);
  check('none → 状态行（聚合器页不算网站证据）', st({ status: 'none' }).includes('website_check: none（未提供有效官方网站'), true);
  check('websiteCheck=null（功能关）→ 无状态行', st(null).includes('website_check:'), false);
  check('addressVerified=false 不渲染（调用侧只构造 addressVerified 票，此处双保险）',
    buildPrestageState(tokenData, data, { addressVerified: false, websiteCheck: { status: 'unreachable', url: 'x' } }).state.includes('website_check:'), false);

  console.log('== 4. resolveWebsiteCheck（代码端事实层；config 读真实文件 enabled=true） ==');
  const sites = (urls) => ({ classifiedUrls: { websites: urls.map(u => ({ url: u })) } });
  // ⚠全部触达抓站的用例必须注入 fetchWebsite——缺省会走真 fetchWebsiteContent
  // （真网络 + CachedFetcher 真写 external_resource_cache，零 DB 零网络红线）
  const noFetch = async () => { throw new Error('不应触达抓站'); };
  const fetched = { url: 'https://fourge.fun/', content: 'FOURGE launchpad — create tokens on BSC' };
  const stubFetch = async () => fetched;
  check('无 websites 桶 → none', await resolveWebsiteCheck({ classifiedUrls: {} }, { fetchWebsite: noFetch }), { status: 'none' });
  check('全聚合器自动页 → none（C99 红线）', await resolveWebsiteCheck(sites(['https://gmgn.ai/bsc/token/0xf9de', 'https://dexscreener.com/bsc/0xf9de']), { fetchWebsite: noFetch }), { status: 'none' });
  check('聚合器页后首个真站命中', (await resolveWebsiteCheck(sites(['https://gmgn.ai/bsc/token/0xf9de', 'https://fourge.fun/']), { fetchWebsite: stubFetch })).url, 'https://fourge.fun/');
  check('抓取失败 → unreachable（抓不到=拦）', await resolveWebsiteCheck(sites(['https://fourge.fun/']), { fetchWebsite: async () => null }),
    { status: 'unreachable', url: 'https://fourge.fun/' });
  check('抓取 throw → 同 unreachable（不冒泡）', await resolveWebsiteCheck(sites(['https://fourge.fun/']), { fetchWebsite: async () => { throw new Error('boom'); } }),
    { status: 'unreachable', url: 'https://fourge.fun/' });
  check('抓取成功 → reachable + info', await resolveWebsiteCheck(sites(['https://fourge.fun/']), { fetchWebsite: stubFetch }),
    { status: 'reachable', url: 'https://fourge.fun/', info: fetched });
  let reused = 0;
  const reuse = await resolveWebsiteCheck(
    { ...sites(['https://fourge.fun/']), websiteInfo: fetched },
    { fetchWebsite: async () => { reused++; return fetched; } },
  );
  check('isProjectCoin 已抓站复用（零重复抓取）', { reused: reused === 0, ...reuse }, { reused: true, status: 'reachable', url: 'https://fourge.fun/', info: fetched });

  console.log('== 5. 接线源码口径锁 ==');
  const svcSrc = fs.readFileSync('src/narrative/analyzer/services/account-analysis-service.mjs', 'utf8');
  check('只对 addressVerified=true 票构造 websiteCheck',
    svcSrc.includes('const websiteCheck = rulesResult.addressVerified'), true);
  check('buildPrestageState 透传 websiteCheck', svcSrc.includes('websiteCheck,'), true);
  check('缺省抓站闭包透传 config fetchTimeoutMs 超时',
    svcSrc.includes('cfg.fetchTimeoutMs || 10000') && svcSrc.includes('fetchWebsiteContent(u, { maxLength: 5000, timeout })'), true);
  check('config enabled===false 才关（默认开）', svcSrc.includes('cfg.enabled === false'), true);

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
