/**
 * 创建页「点位类型激活」开关——真实 DOM 渲染冒烟（T242；零依赖：本机 Chrome headless + CDP over WebSocket）。
 * 改创建页开关 / 策略包信息卡 / 提交载荷收集后必跑（前端真实 DOM 纪律：数据链验证不算数）。
 *
 * 前置：本地 web 实例已在跑（建议 WEB_PORT=3999 另起，别动 3010；严禁在远程服务器起 web）。
 * 用法：node scripts/tmp-create-page-point-types-smoke.cjs [baseUrl=http://localhost:3999] [包名=trading-standard-v1]
 * 零落库：创建请求在页面内被 fetch 桩拦截（拿到请求体即回假成功），不发到服务端。
 * 覆盖：选包后开关区出现与缺省初值 / normal 恒勾选禁用 / 专属腿提示 / 手改后摘要 /
 *       换包保留用户选择 / 清空选择隐藏 / 提交载荷带或不带 pointTypes / 恢复缺省 /
 *       复制模式以源实验覆盖为初值 / 全程无页面异常。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + Math.floor(Math.random() * 400);
const BASE = process.argv[2] || 'http://localhost:3999';
const PACK_NAME = process.argv[3] || 'trading-standard-v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; log(`  ✓ ${name}`); } else { fail++; log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
};
(async () => {
  // 包 id 按名解析（手敲长地址/uuid 会错——一律名字解析）
  const packs = (await (await fetch(`${BASE}/api/strategy-library`)).json()).data || [];
  const MAIN = (packs.find((x) => x.name === PACK_NAME) || {}).id;
  if (!MAIN) throw new Error('策略包不存在: ' + PACK_NAME);
  // 期望值一律按注册表接口算（行数/顺序/缺省勾选）——注册表加类型本冒烟零改动
  const TYPES = (await (await fetch(`${BASE}/api/strategy-library/point-types`)).json()).data.types;
  const IDS = TYPES.map((t) => t.id);
  const DEF = IDS.map((id) => id === 'normal' || TYPES.find((t) => t.id === id).active === true);
  const prof = `/tmp/rj-cdp/prof-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,1600', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find((t) => t.type === 'page'); } catch (e) { /* not up yet */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome 调试口未就绪');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map(); const consoleErrors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error('页面脚本异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 120000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) { if (await ev(expression)) return true; await sleep(300); }
      throw new Error('等待超时: ' + label);
    };
    await send('Page.enable'); await send('Runtime.enable');
    const nav = async (url) => { await send('Page.navigate', { url }); await sleep(800); };
    const domState = () => ev(`(() => {
      const sec = document.getElementById('point-types-section');
      return {
        hidden: sec.hidden,
        rows: [...sec.querySelectorAll('input.point-type-cb')].map((cb) => ({ id: cb.dataset.ptId, checked: cb.checked, disabled: cb.disabled, text: cb.closest('label').innerText.replace(/\\n/g, ' | ') })),
        summary: document.getElementById('point-types-summary').innerText,
        packBadges: [...document.querySelectorAll('#strategy-pack-info .bg-green-100')].map((x) => x.innerText),
      };
    })()`);

    log('\n[K1] 非复制模式：选主包 → 开关区出现，初值=注册表缺省');
    await nav(`${BASE}/create-experiment?_cb=${Date.now()}`);
    await waitFor(`document.querySelectorAll('#strategy-pack-select option').length > 1`, '策略包列表');
    check('K1 选包前开关区隐藏', (await domState()).hidden, true);
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = '${MAIN}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`!document.getElementById('point-types-section').hidden`, '开关区显示');
    // K1 选包 → 开关区出现，初值=注册表缺省（行数/顺序/缺省勾选全部按注册表接口算，不写死）
    let st = await domState();
    check('K1 包信息卡模块徽章（含 pointType；三门标因子代）', st.packBadges, ['因子门(FP):v1', '作弊门:v2·因子代', '前置活跃度门:v2·因子代', 'BP买点门:v2·因子代', '点位类型(PT):v1']);
    check(`K1 ${IDS.length} 行、注册表顺序`, st.rows.map((r) => r.id), IDS);
    check('K1 初值=注册表缺省；normal 勾选且禁用', st.rows.map((r) => [r.checked, r.disabled]), IDS.map((id, i) => [DEF[i], id === 'normal']));
    const nAct = DEF.filter(Boolean).length;
    check('K1 摘要：缺省态不写配置、专属腿全在', st.summary, `激活 ${nAct} / 未激活 ${IDS.length - nAct} ｜ 专属腿全在 ｜ 与注册表缺省一致（不写配置）`);
    check('K1 专属腿提示挂在对应类型行', st.rows.filter((r) => r.text.includes('专属腿')).map((r) => r.id + ':' + (r.text.match(/专属腿 P\d+/) || [''])[0]), ['famous_holder_cold_pit:专属腿 P16', 'strongbacker_solo_dance:专属腿 P17', 'famous_participation_pit:专属腿 P18', 'steady_trend_climb:专属腿 P19', 'market_maker_rhythm_pit:专属腿 P20']);
    const NROW = `document.querySelectorAll('input.point-type-cb').length === ${IDS.length}`;

    log('\n[K4] 手改后换包：用户勾选保留；换到另一个启用 pointType 的包开关区仍在');
    await ev(`document.querySelector('input.point-type-cb[data-pt-id="steady_trend_climb"]').click()`);
    const OTHER = await ev(`[...document.querySelectorAll('#strategy-pack-select option')].map((o) => o.value).find((v) => v && v !== '${MAIN}' && v !== '')`);
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = '${OTHER}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`!document.getElementById('point-types-section').hidden && ${NROW}`, '换包后开关区');
    st = await domState();
    check('K4 换包后开关区仍在、用户勾选保留（持续趋势仍为未勾，其余缺省）', [st.hidden, st.rows.map((r) => r.checked)], [false, DEF.map((v, i) => (IDS[i] === 'steady_trend_climb' ? false : v))]);
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = '${MAIN}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`document.getElementById('point-types-summary').innerText.includes('P19')`, '换回主包');
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`document.getElementById('point-types-section').hidden`, '清空选择后开关区隐藏');
    check('K4 清空包选择 → 开关区隐藏（无包可谈激活）', (await domState()).hidden, true);
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = '${MAIN}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`!document.getElementById('point-types-section').hidden && ${NROW}`, '重选主包');

    log('\n[K2] 勾上 slow_develop_early → 摘要与提交载荷（请求被拦截，零落库）');
    await ev(`document.querySelector('input.point-type-cb[data-pt-id="slow_develop_early"]').click()`);
    st = await domState();
    check('K2 摘要：P19 不组装 + 将写 config.pointTypes', st.summary, `激活 ${nAct} / 未激活 ${IDS.length - nAct} ｜ 专属腿不组装：P19 ｜ 提交时写 config.pointTypes`);
    const K2_WANT = Object.fromEntries(IDS.map((id) => [id, id === 'normal' || id === 'slow_develop_early' || (DEF[IDS.indexOf(id)] && id !== 'steady_trend_climb')]));
    const intercept = `(() => { window.__posts = []; const orig = window.fetch; window.fetch = (u, o) => { if (typeof u === 'string' && u.endsWith('/api/experiments') && o && o.method === 'POST') { window.__posts.push(JSON.parse(o.body)); return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { id: 'fake', experiment_name: 'fake' } }) }); } return orig(u, o); }; document.querySelector('[name="experiment_name"]').value = 'rj-cdp-probe'; document.querySelector('form').requestSubmit(); return true; })()`;
    await ev(intercept);
    await waitFor(`window.__posts.length >= 1`, '提交请求');
    let body = await ev('window.__posts[0]');
    check('K2 提交载荷带 pointTypes（P19 关、slow_develop_early 开，其余=注册表缺省）', body.pointTypes, { active: K2_WANT });
    check('K2 载荷 strategyId=主包', body.strategy.strategyId, MAIN);
    await waitFor(`document.getElementById('result-content').innerText.includes('实验创建成功')`, '成功提示', 15000);
    check('K2 提交成功提示渲染（存量提交崩溃已修：按钮不再卡在创建中）', await ev(`[document.getElementById('result-content').innerText.includes('✅'), document.getElementById('submit-btn').textContent]`), [true, '创建中...']);

    log('\n[K3] 恢复注册表缺省 → 提交不带 pointTypes');
    await nav(`${BASE}/create-experiment?_cb=${Date.now()}`);
    await waitFor(`document.querySelectorAll('#strategy-pack-select option').length > 1`, '策略包列表');
    await ev(`(() => { const s = document.getElementById('strategy-pack-select'); s.value = '${MAIN}'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitFor(`!document.getElementById('point-types-section').hidden && ${NROW}`, '开关区');
    await ev(`document.querySelector('input.point-type-cb[data-pt-id="market_maker_rhythm_pit"]').click()`);
    await waitFor(`document.getElementById('point-types-summary').innerText.includes('P20')`, '手改后摘要');
    await ev(`document.getElementById('point-types-reset').click()`);
    await waitFor(`document.getElementById('point-types-summary').innerText.includes('不写配置') && !document.getElementById('point-types-summary').innerText.includes('P20')`, '重置后摘要');
    st = await domState();
    check('K3 「恢复注册表缺省」：勾选回到缺省（做市节奏重新勾上、slow_develop_early 仍未勾）', st.rows.map((r) => r.checked), DEF);
    await ev(intercept);
    await waitFor(`window.__posts.length >= 1`, '二次提交');
    body = await ev('window.__posts[0]');
    check('K3 缺省态载荷无 pointTypes 键', Object.prototype.hasOwnProperty.call(body, 'pointTypes'), false);

    log('\n[K5] 复制模式：源实验带 pointTypes（只激活 normal）→ 开关以它为初值');
    const ONLY_NORMAL = Object.fromEntries(IDS.map((id) => [id, id === 'normal']));
    const copyData = JSON.stringify({ experiment_name: 'src', experiment_description: '', trading_mode: 'virtual', platform: 'fourmeme', strategyId: MAIN, initial_balance: 100, pointTypes: { active: ONLY_NORMAL } });
    await ev(`sessionStorage.setItem('copyExperimentData', ${JSON.stringify(copyData)})`);
    await nav(`${BASE}/create-experiment?copy=true&_cb=${Date.now()}`);
    await waitFor(`!document.getElementById('point-types-section').hidden`, '复制模式开关区');
    await waitFor(NROW, '复制模式行数');
    st = await domState();
    check('K5 初值=复制携带覆盖（只激活 normal）', st.rows.map((r) => r.checked), IDS.map((id) => id === 'normal'));
    check('K5 摘要：专属腿 P16~P20 全停', st.summary, `激活 1 / 未激活 ${IDS.length - 1} ｜ 专属腿不组装：P16/P17/P18/P19/P20 ｜ 提交时写 config.pointTypes`);
    await ev(intercept);
    await waitFor(`window.__posts.length >= 1`, '复制模式提交');
    body = await ev('window.__posts[0]');
    check('K5 提交载荷带只激活 normal 的 pointTypes', [body.pointTypes && Object.keys(body.pointTypes.active).filter((k) => body.pointTypes.active[k]), body.strategy.strategyId], [['normal'], MAIN]);
    check('K5 全程无页面异常 / console.error', consoleErrors, []);
    log(`\n${'='.repeat(60)}\n创建页点位类型开关真实 DOM 冒烟：${pass} 通过，${fail} 失败`);
    try { await send('Browser.close'); } catch (e) { /* 已关 */ }
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    log('❌ 验证脚本异常:', e.stack || e); try { chrome.kill('SIGKILL'); } catch (x) { /* noop */ } process.exit(1);
  } finally { setTimeout(() => { try { chrome.kill('SIGKILL'); } catch (e) { /* noop */ } fs.rmSync(prof, { recursive: true, force: true }); }, 1500); }
})();
