/**
 * 信号页「只展示成交信号附近数据」——真实 DOM 冒烟（零依赖：本机 Chrome headless + CDP over WebSocket）。
 * 改 signals 页成交聚焦（开关/前后秒数/_trimTicksByWindow 聚焦分支/区间补拉/成交标注时刻）后必跑
 * （前端真实 DOM 纪律：数据链验证不算数）。配套 stub-DOM 冒烟 scripts/tmp-signals-five-layer-smoke.cjs。
 *
 * 前置：本地 web 实例已在跑（严禁在远程服务器起 web）。只读 GET，零落库。
 * 用法：node scripts/tmp-signals-trade-focus-smoke.cjs [baseUrl=http://localhost:3010] [expId] [tokenAddress]
 *       缺省实验/代币=2026-11-28 用户案源（回测 bt-v340：14 信号跨 10h、成交 69s；回测 executed_at=墙钟）
 *       期望值一律按接口数据现算（成交锚=已执行信号时刻 ∪ 成交记录 created_at），不写死。
 * 覆盖：K1 初始态（回测票成交▲▼ 在场=created_at 修复）/ K2 开关→窗口·四图钉轴·窗内标注·状态条·
 *       排版不折行 / K3 前后秒数（含非法值回 60）/ K4 关闭回到原窗口 / K5 与「应用/重置/加载全量」互斥 /
 *       K6 基数截断→按窗口 from/to 自动补拉 + 接口忽略时间范围=显式报错不画假数据 /
 *       K7 下拉切票聚焦保持 + 无成交信号票回落默认窗口 / K7b 截断基数下切票（已覆盖窗尾=零补拉、
 *       未覆盖=补拉一次——锁 loadKlineForToken 把新票基数传给覆盖判定）/ K8 全程无页面异常（K6 失败注入的那一条除外）
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + Math.floor(Math.random() * 400);
const BASE = process.argv[2] || 'http://localhost:3010';
const EXP = process.argv[3] || '8b7850d5-bcd6-49be-89ef-c97c7672c801';
const TOK = (process.argv[4] || '0xb28547c77bc4c4a3e5a631fd0e7eb500eb6e7777').toLowerCase();
const VIEW = { width: 1440, height: 1000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; log(`  ✓ ${name}`); } else { fail++; log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
};
const iso = (ms) => new Date(ms).toISOString();

(async () => {
  const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.json(); };
  // ── 期望值原料（接口数据）──
  const sigsA = (await j(`${BASE}/api/experiment/${EXP}/signals?tokenAddress=${TOK}&limit=10000`)).signals || [];
  const tradesA = (await j(`${BASE}/api/experiment/${EXP}/trades?tokenAddress=${TOK}&success=true&limit=1000`)).data || [];
  // 成交时刻取列与页面 _tradeTimeMs 同规则：回测 created_at（executed_at=落库墙钟）/ 虚拟·实盘 executed_at
  const IS_BACKTEST = ((await j(`${BASE}/api/experiment/${EXP}`)).data || {}).tradingMode === 'backtest';
  const tradeMs = (t) => Date.parse(IS_BACKTEST ? (t.created_at || t.executed_at) : (t.executed_at || t.created_at));
  const expTradeX = (dir) => tradesA.filter((t) => t.trade_direction === dir).map(tradeMs).sort((a, b) => a - b).map(iso);
  const nBuy = tradesA.filter((t) => t.trade_direction === 'buy').length;
  const nSell = tradesA.filter((t) => t.trade_direction === 'sell').length;
  const anchors = [
    ...sigsA.filter((s) => s.executed === true && s.signal_type !== 'OBSERVE').map((s) => Date.parse(s.timestamp || s.created_at)),
    ...tradesA.map(tradeMs),
  ].filter(Number.isFinite).sort((a, b) => a - b);
  if (nBuy < 1 || nSell < 1 || anchors.length < 2) throw new Error(`案源票须同时有买/卖成交：buy=${nBuy} sell=${nSell} anchors=${anchors.length}`);
  const expWin = (padSec) => [iso(anchors[0] - padSec * 1000), iso(anchors[anchors.length - 1] + padSec * 1000)];
  const ticksA = (await j(`${BASE}/api/ticks?tokenAddress=${TOK}&limit=5000`)).data || [];
  if (ticksA.length <= 60) throw new Error(`案源票 ticks 须 >60（K6 截断桩取前 40 条）：${ticksA.length}`);
  const tickMs = ticksA.map((t) => Date.parse(t.block_time)).filter(Number.isFinite);
  // 图上标注期望（与页面 _buildSignalAnnotations/_buildTradeAnnotations/轮次/观察/反作弊同口径）：
  // 窗内非观察信号线 + 成交细线（成交锚全在窗内）+ 窗内叙事轮次（析起/析毕各一）+ 观察行 + 反作弊行
  const roundsA = (await j(`${BASE}/api/experiment/${EXP}/narrative-rounds?tokenAddress=${TOK}`)).rounds || [];
  const observeA = (await j(`${BASE}/api/experiment/${EXP}/signals?tokenAddress=${TOK}&signalType=OBSERVE&limit=200`)).signals || [];
  const cheatA = (await j(`${BASE}/api/experiment/${EXP}/cheat-detections?tokenAddress=${TOK}`)).data || [];
  const inRange = (t, ws, we) => Number.isFinite(t) && t >= ws && t <= we;
  const expAnn = (padSec) => {
    const [a, b] = expWin(padSec).map(Date.parse);
    const sigLines = sigsA.filter((x) => x.signal_type !== 'OBSERVE' && inRange(Date.parse(x.timestamp || x.created_at), a, b));
    const unexec = sigLines.filter((x) => !(x.executed === true || x.executed === 'true')).length; // 成交细点线也是虚线，计入 dashed
    const marks = [
      ...roundsA.flatMap((r) => [Date.parse(r.started_at), r.completed_at ? Date.parse(r.completed_at) : NaN]),
      ...observeA.map((x) => Date.parse(x.timestamp || x.created_at)),
      ...cheatA.filter((c) => c.grade || c.verdict === 'timeout' || c.verdict === 'error').map((c) => Date.parse(c.analyzed_at)),
    ].filter((t) => inRange(t, a, b)).length;
    return { total: sigLines.length + tradesA.length + marks, dashed: unexec + tradesA.length + marks }; // 轮次/观察/反作弊标注同为虚线
  };
  // 全量模式窗口边界=首末信号时刻（含观察行）±5min（存量语义：_trimTicksByWindow 全量分支取信号界非 ticks 界）
  const SIG_TIMES = [...sigsA, ...observeA].map((x) => Date.parse(x.timestamp || x.created_at)).filter(Number.isFinite);
  const FULL_WIN = [iso(Math.min(...SIG_TIMES) - 5 * 60 * 1000), iso(Math.max(...SIG_TIMES) + 5 * 60 * 1000), false];
  const expTicksInWin = (padSec) => { const [a, b] = expWin(padSec).map(Date.parse); return tickMs.filter((t) => t >= a && t <= b).length; };
  // 图上 tick 气泡点总数（主买/卖 + famous/聪明钱/机器 标记，互斥分区）：窗口内足额 ticks（与页面 MIN_BNB=0.005 同口径）
  const ptsIn = (arr, padSec) => { const [a, b] = expWin(padSec).map(Date.parse); return arr.filter((t) => { const ms = Date.parse(t.block_time); return ms >= a && ms <= b && (parseFloat(t.bnb_amount) || 0) >= 0.005 && (parseFloat(t.price_usd) || 0) > 0; }).length; };
  const tickPts = (st) => Object.entries(st.legend).filter(([k]) => !k.startsWith('成交')).reduce((n, [, v]) => n + v, 0);
  const firstTick = Math.min(...tickMs);
  const in600 = tickMs.filter((ms) => ms <= firstTick + 600 * 1000);
  // K7 的第二张票：有真实 ticks 的另一张成交票（页面内桩把它的成交剥掉=「无成交信号」形状）
  const tradeAll = (await j(`${BASE}/api/experiment/${EXP}/trades?limit=1000`)).data || [];
  const tok2 = tradeAll.map((t) => t.token_address).find((a) => a && a.toLowerCase() !== TOK);
  if (!tok2) throw new Error('实验里找不到第二张成交票（K7 需要）');
  // K7b 的第三张票：买+卖成交都在生命周期前段——截断桩的前 TRUNC_N 条 ticks 已覆盖「末成交锚+60s」
  // （=页面覆盖判定「末条 tick ≥ 窗尾」成立 → 切过去必须零补拉）。找不到=跳过 K7b
  const TRUNC_N = 40;
  const tok3 = await (async () => {
    const by = new Map();
    for (const t of tradeAll) {
      const a = t.token_address; if (!a) continue;
      const v = by.get(a) || { b: 0, s: 0 }; if (t.trade_direction === 'buy') v.b++; else if (t.trade_direction === 'sell') v.s++; by.set(a, v);
    }
    for (const [a, v] of by) {
      if (!v.b || !v.s || a.toLowerCase() === TOK || a === tok2) continue;
      const rows = (await j(`${BASE}/api/ticks?tokenAddress=${a}&limit=${TRUNC_N + 1}`)).data || [];
      if (rows.length <= TRUNC_N) continue; // 截断桩对它不生效（单页即全量）
      const tr = (await j(`${BASE}/api/experiment/${EXP}/trades?tokenAddress=${a}&success=true&limit=1000`)).data || [];
      const last = Math.max(-Infinity, ...tr.map(tradeMs));
      if (Date.parse(rows[TRUNC_N - 1].block_time) < last + 60 * 1000) continue;
      const sg = (await j(`${BASE}/api/experiment/${EXP}/signals?tokenAddress=${a}&limit=10000`)).signals || [];
      const an = [...sg.filter((x) => x.executed === true && x.signal_type !== 'OBSERVE').map((x) => Date.parse(x.timestamp || x.created_at)), ...tr.map(tradeMs)].filter(Number.isFinite).sort((x, y) => x - y);
      if (!an.length) continue;
      return { address: a, win: [iso(an[0] - 60 * 1000), iso(an[an.length - 1] + 60 * 1000)] };
    }
    return null;
  })();
  log(`实验 ${EXP}（${IS_BACKTEST ? '回测' : '虚拟/实盘'}）\n案源：${TOK} 信号 ${sigsA.length} 条 · 成交 买${nBuy}/卖${nSell} · ticks ${ticksA.length} · 成交锚跨度 ${((anchors[anchors.length - 1] - anchors[0]) / 1000).toFixed(1)}s\n第二票：${tok2}`);

  // ── 页面内 fetch 桩（新文档前注入；模式开关走 sessionStorage，各段进页面前设置）──
  const STUB = `(() => {
    const S = sessionStorage; const EXP = ${JSON.stringify(EXP)}; const TOK = ${JSON.stringify(TOK)}; const TOK2 = ${JSON.stringify(tok2)}; const TOK3 = ${JSON.stringify(tok3 ? tok3.address : null)};
    const orig = window.fetch.bind(window);
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const strip = (arr) => (arr || []).forEach((x) => { x.executed = false; x.execution_status = 'failed'; }); // 第二票=「无成交信号」形状
    window.__smoke = { tickReqs: [] };
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const u = new URL(url, location.origin); const q = u.searchParams; const m = S.getItem('rj-smoke-mode') || '';
      if ((m === 'trunc' || (m === 'dropdown' && S.getItem('rj-smoke-trunc') === '1')) && u.pathname === '/api/ticks') {
        if (q.has('from') && q.has('to')) {
          window.__smoke.tickReqs.push({ from: q.get('from'), to: q.get('to') });
          if (S.getItem('rj-smoke-ignore-range') === '1') { q.delete('from'); q.delete('to'); return orig(u.origin + u.pathname + '?' + q); } // 模拟旧进程：忽略时间范围回最早一页
          return orig(input, init);
        }
        const data = await (await orig(input, init)).json();
        data.data = (data.data || []).slice(0, 40); // 单页基数截断：只回前 40 条，total 保持真实值
        return json(data);
      }
      if (m === 'dropdown' && u.pathname === '/api/experiment/' + EXP + '/signals') {
        const ta = q.get('tokenAddress');
        if (!ta) { // 全量信号请求换成只含两张票（真全量太重；逐票请求走原 fetch）
          const parts = await Promise.all([TOK, TOK2, TOK3].filter(Boolean).map((t) => orig('/api/experiment/' + EXP + '/signals?tokenAddress=' + t + '&limit=10000').then((r) => r.json())));
          strip(parts[1].signals); // 主响应里的第二票同样剥成交
          return json({ success: true, count: parts.reduce((n, p) => n + p.signals.length, 0), signals: parts.flatMap((p) => p.signals) });
        }
        if (ta === TOK2) { const data = await (await orig(input, init)).json(); strip(data.signals); return json(data); }
      }
      if (m === 'dropdown' && u.pathname === '/api/experiment/' + EXP + '/trades' && q.get('tokenAddress') === TOK2) return json({ success: true, data: [] });
      return orig(input, init);
    };
  })();`;

  const prof = `/tmp/rj-cdp/prof-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find((t) => t.type === 'page'); } catch (e) { /* not up yet */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome 调试口未就绪');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map(); const pageErrors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') pageErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error('页面脚本异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 120000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) { if (await ev(expression)) return true; await sleep(250); }
      throw new Error('等待超时: ' + label);
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false });
    const SIG_PAGE = `${BASE}/experiment/${EXP}/signals`;
    const chartReady = '!!(window.experimentSignals && window.experimentSignals.chart && window.experimentSignals._lastTickData)';
    // 下拉模式就绪：桩给的票都在选择器里（全部代币 + 第二票 [+ K7b 第三票]）
    const DROPDOWN_READY = `!!(window.experimentSignals && window.experimentSignals.signals.length > 0 && document.querySelectorAll('#token-selector option').length === ${3 + (tok3 ? 1 : 0)} && window.experimentSignals._experimentData)`;
    const nav = async (url, ready = chartReady) => {
      await send('Page.navigate', { url });
      await waitFor(ready, '页面就绪 ' + url.replace(BASE, ''));
      await sleep(900);
    };
    // 页面状态快照（真实 Chart 实例的轴范围/数据集计数/标注 + 控件计算样式）
    const state = () => ev(`(() => {
      const s = window.experimentSignals;
      const iso = (ms) => ms == null ? null : new Date(ms).toISOString();
      const xr = (ch) => (ch && ch.scales && ch.scales.x && ch.scales.x.min != null) ? [iso(ch.scales.x.min), iso(ch.scales.x.max)] : null;
      const w = s._lastWindow;
      const legend = {};
      for (const d of (s.chart ? s.chart.data.datasets : [])) { const m = /^(.*) \\((\\d+)\\)$/.exec(d.label); if (m) legend[m[1]] = Number(m[2]); }
      const btn = document.getElementById('trade-focus-toggle');
      const bar = document.querySelector('#kline-chart-wrapper .p-4.flex-wrap.items-center.justify-between > div.flex');
      return {
        focus: s._tradeFocus, pad: s._tradeFocusPadSec, complete: s._tickDataComplete, full: s._fullTickRange, tickWindowSec: s.tickWindowSec,
        baseTicks: (s._lastTickData || []).length,
        focusTicks: s._tradeFocusTicks ? s._tradeFocusTicks.ticks.length : null,
        win: w ? [iso(w.trimStart), iso(w.trimEnd), !!w.pinned] : null,
        x: { bubble: xr(s.chart), candle: xr(s.candleChart), vol: xr(s.candleVolumeChart), holder: xr(s.holderChart) },
        legend,
        annX: s.chart ? s.chart.options.plugins.annotation.annotations.map((a) => iso(a.xMin)) : null,
        dashedN: s.chart ? s.chart.options.plugins.annotation.annotations.filter((a) => Array.isArray(a.borderDash) && a.borderDash.length > 0).length : null,
        tradeX: (() => { const o = { buy: [], sell: [] }; for (const d of (s.chart ? s.chart.data.datasets : [])) { if (d.label.startsWith('成交▲')) o.buy = d.data.map((p) => iso(p.x)).sort(); if (d.label.startsWith('成交▼')) o.sell = d.data.map((p) => iso(p.x)).sort(); } return o; })(),
        btnBg: getComputedStyle(btn).backgroundColor,
        pressed: btn.getAttribute('aria-pressed'),
        padShown: !document.getElementById('trade-focus-pad-wrap').classList.contains('hidden'),
        padValue: document.getElementById('trade-focus-pad').value,
        status: document.getElementById('trade-focus-status').textContent,
        statusShown: !document.getElementById('trade-focus-status').classList.contains('hidden'),
        statusColor: getComputedStyle(document.getElementById('trade-focus-status')).color,
        token: s._lastToken ? String(s._lastToken.address).toLowerCase() : null,
        layout: {
          applyH: Math.round(document.getElementById('apply-tick-window').getBoundingClientRect().height),
          resetH: Math.round(document.getElementById('reset-tick-window').getBoundingClientRect().height),
          toggleH: Math.round(btn.getBoundingClientRect().height),
          overflow: bar ? bar.scrollWidth - bar.clientWidth : null,
          toggleText: btn.textContent.trim(),
        },
      };
    })()`);
    const click = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
    const setPad = (v) => ev(`(() => { const i = document.getElementById('trade-focus-pad'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change')); return true; })()`);
    const shot = async (name) => {
      const clip = await ev(`(() => { const r = document.getElementById('kline-chart-wrapper').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 8), width: ${VIEW.width}, height: Math.round(Math.min(${VIEW.height}, r.bottom - r.top + 16)) }; })()`);
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      const f = `/tmp/rj-cdp/smoke-${name}.png`;
      try { fs.mkdirSync('/tmp/rj-cdp', { recursive: true }); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); return f; } catch (e) { return null; }
    };

    // ════════ K1~K5：真实单票直达页（无桩） ════════
    log('\n[K1] 初始态：聚焦关、默认窗口；回测票成交▲▼ 在场（created_at 修复——旧行为恒 0）');
    await nav(`${SIG_PAGE}?token=${TOK}&_cb=${Date.now()}`);
    let st = await state();
    const WIN0 = st.win, BTN_OFF = st.btnBg;
    check('K1 聚焦关/按钮 aria-pressed=false/秒数控件隐藏/状态条隐藏', [st.focus, st.pressed, st.padShown, st.statusShown], [false, 'false', false, false]);
    check('K1 默认窗口未钉轴（pinned=false）且含全部信号', [st.win[2], st.baseTicks === ticksA.length], [false, true]);
    check('K1 成交▲▼ 计数=真实成交数（买/卖）', [st.legend['成交▲'], st.legend['成交▼']], [nBuy, nSell]);
    check(`K1 成交▲▼ 标记时刻=按模式取列（${IS_BACKTEST ? '回测 created_at' : '虚拟/实盘 executed_at'}）`, st.tradeX, { buy: expTradeX('buy'), sell: expTradeX('sell') });
    check('K1 默认窗口覆盖全部成交锚（窗口两端含首末锚）', [Date.parse(WIN0[0]) <= anchors[0], Date.parse(WIN0[1]) >= anchors[anchors.length - 1]], [true, true]);

    log('\n[K2] 点击开关：窗口=首末成交锚 ±60s，四图 X 轴钉窗，窗外信号线不画');
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned', '聚焦窗口生效');
    await sleep(700);
    st = await state();
    const W60 = [...expWin(60), true];
    check('K2 聚焦开/aria-pressed=true/按钮换色', [st.focus, st.pressed, st.btnBg !== BTN_OFF, st.btnBg], [true, 'true', true, 'rgb(217, 119, 6)']);
    check('K2 窗口=首末成交锚 ±60s（钉轴）', st.win, W60);
    check('K2 四图 X 轴=窗口两端', st.x, { bubble: expWin(60), candle: expWin(60), vol: expWin(60), holder: expWin(60) });
    const [w60s, w60e] = expWin(60).map(Date.parse);
    check('K2 图上标注全部落在窗内（远处未成交信号线不再画）', st.annX.every((t) => Date.parse(t) >= w60s && Date.parse(t) <= w60e), true);
    check('K2 标注条数=接口现算（窗内信号线+成交细线+轮次/观察/反作弊）', [st.annX.length, expAnn(60).total], [expAnn(60).total, expAnn(60).total]);
    const ANN60 = st.annX.length;
    check('K2 tick 气泡点总数=窗口内足额 ticks 数（接口现算）', tickPts(st), ptsIn(ticksA, 60));
    check('K2 成交▲▼=全部成交', [st.legend['成交▲'], st.legend['成交▼']], [nBuy, nSell]);
    check('K2 秒数控件显示（值 60）+ 状态条=成交笔数与窗口时刻', [st.padShown, st.padValue, st.status.startsWith(`成交 ${tradesA.length} 笔 · `), st.status], [true, '60', true, st.status]);
    check('K2 窗口跨度 < 默认窗口跨度（成交段不再被撑扁）', Date.parse(W60[1]) - Date.parse(W60[0]) < Date.parse(WIN0[1]) - Date.parse(WIN0[0]), true);
    check('K2 排版：应用/重置/开关三按钮等高单行、工具栏不横向溢出', [st.layout.applyH === st.layout.resetH, st.layout.toggleH <= st.layout.resetH + 2, st.layout.overflow <= 0, st.layout.toggleText], [true, true, true, '🎯 只展示成交信号附近数据']);
    const K2_LEGEND = st.legend;
    log('  截图 ' + (await shot('k2-focus-on')));

    log('\n[K3] 前后秒数：300 生效；空值/0/负数回 60 并回写输入框');
    await setPad('300');
    await waitFor(`window.experimentSignals._tradeFocusPadSec === 300 && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '秒数 300 生效');
    await sleep(500);
    st = await state();
    check('K3 秒数 300 → 窗口 ±300s、四图同窗', [st.win, st.x], [[...expWin(300), true], { bubble: expWin(300), candle: expWin(300), vol: expWin(300), holder: expWin(300) }]);
    check('K3 窗口放宽 → 标注只增不减', st.annX.length >= ANN60, true);
    // 窗口放大到把远处未成交信号也框进来：它们照常画虚线（本模式只改窗口，不改信号画法）
    const BIG = Math.ceil((anchors[0] - Math.min(...sigsA.map((x) => Date.parse(x.timestamp || x.created_at)).filter(Number.isFinite))) / 1000) + 600;
    const bigAnn = expAnn(BIG);
    await setPad(String(BIG));
    await waitFor(`window.experimentSignals._tradeFocusPadSec === ${BIG} && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '大窗口生效');
    await sleep(500);
    st = await state();
    check(`K3 窗口放大到 ±${BIG}s 框进全部信号：标注总数=接口现算、虚线=窗内未执行信号线+成交细点线`, [st.annX.length, st.dashedN], [bigAnn.total, bigAnn.dashed]);
    check('K3 大窗口下全部成交▲▼ 仍在', [st.legend['成交▲'], st.legend['成交▼']], [nBuy, nSell]);
    await setPad('300');
    await waitFor(`window.experimentSignals._tradeFocusPadSec === 300 && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '秒数 300 生效');
    await sleep(400);
    for (const bad of ['', '0', '-5']) {
      await setPad(bad);
      await sleep(400);
      st = await state();
      check(`K3 非法值 ${JSON.stringify(bad)} → 回 60 并回写`, [st.pad, st.padValue, st.win], [60, '60', W60]);
    }

    log('\n[K4] 再点开关：关闭 → 逐位回到默认窗口');
    await click('trade-focus-toggle');
    await waitFor('!window.experimentSignals._tradeFocus', '聚焦关闭');
    await sleep(600);
    st = await state();
    check('K4 聚焦关/按钮回灰/秒数控件隐藏/状态条隐藏', [st.focus, st.pressed, st.btnBg === BTN_OFF, st.padShown, st.statusShown], [false, 'false', true, false, false]);
    check('K4 窗口逐位回到初始默认窗口', st.win, WIN0);

    log('\n[K5] 与「应用/重置/加载全量」互斥：任一操作退出聚焦');
    await ev(`(() => { document.getElementById('trade-focus-toggle').click(); return true; })()`);
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned', '聚焦开启');
    await ev(`(() => { document.getElementById('tick-time-window').value = '600'; document.getElementById('apply-tick-window').click(); return true; })()`);
    await waitFor('window.experimentSignals.tickWindowSec === 600', 'N 秒窗口生效');
    await sleep(500);
    st = await state();
    check('K5 开启中点「应用」→ 退出聚焦、窗口=代币发出后 600s 内 ticks 边界', [st.focus, st.pressed, st.win, st.x.bubble], [false, 'false', [iso(Math.min(...in600)), iso(Math.max(...in600)), false], [iso(Math.min(...in600)), iso(Math.max(...in600))]]);
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned', '聚焦开启');
    await click('reset-tick-window');
    await waitFor('!window.experimentSignals._tradeFocus && window.experimentSignals.tickWindowSec === null', '重置');
    await sleep(500);
    st = await state();
    check('K5 开启中点「重置」→ 退出聚焦、窗口回默认', [st.focus, st.win], [false, WIN0]);
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned', '聚焦开启');
    await click('load-full-ticks');
    await waitFor('window.experimentSignals._fullTickRange === true', '加载全量完成');
    await sleep(700);
    st = await state();
    check('K5 开启中点「加载全量」→ 退出聚焦、全量模式（基数完整、窗口=首末信号±5min 存量语义）', [st.focus, st.pressed, st.full, st.complete, st.win], [false, 'false', true, true, FULL_WIN]);
    check('K5 全量模式下再开聚焦=零补拉直接钉窗（_tickDataComplete 生效）', await ev(`(async () => { const s = window.experimentSignals; let n = 0; const o = window.fetch; window.fetch = (...a) => { if (String(a[0]).includes('/api/ticks')) n++; return o(...a); }; try { document.getElementById('trade-focus-toggle').click(); await new Promise((r) => setTimeout(r, 800)); return [s._tradeFocus, !!s._lastWindow.pinned, n]; } finally { window.fetch = o; } })()`), [true, true, 0]);

    // ════════ K6：基数截断（单页 ticks 不覆盖成交段）→ 按窗口时间范围自动补拉 ════════
    log('\n[K6] 基数截断：前 40 条 ticks + 真实 total → 开聚焦自动按 from/to 补拉；接口忽略时间范围=显式报错');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await ev(`sessionStorage.setItem('rj-smoke-mode', 'trunc'); sessionStorage.removeItem('rj-smoke-ignore-range'); true`);
    await nav(`${SIG_PAGE}?token=${TOK}&_cb=${Date.now()}`);
    st = await state();
    const WIN_TRUNC = st.win;
    check('K6 桩生效：基数=前 40 条、判为不完整、截断基数不覆盖成交窗口尾（补拉前提成立）', [st.baseTicks, st.complete, Date.parse(st.win[1]) < Date.parse(expWin(60)[1])], [Math.min(40, ticksA.length), false, true]);
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned', '聚焦窗口生效');
    await waitFor('window.experimentSignals._tradeFocusTicks !== null', '区间补拉落缓存');
    await sleep(700);
    st = await state();
    const reqs = await ev('window.__smoke.tickReqs');
    check('K6 补拉请求带 from/to=窗口两端（逐字）', reqs.map((r) => [r.from, r.to]), [expWin(60)]);
    check('K6 窗口/四图钉轴', [st.win, st.x], [W60, { bubble: expWin(60), candle: expWin(60), vol: expWin(60), holder: expWin(60) }]);
    check('K6 补拉条数=窗口内 ticks 数（接口现算；不是整页也不是最早一页）', st.focusTicks, expTicksInWin(60));
    check('K6 补拉后画出的图与完整基数下的聚焦图逐项同计数（数据集计数+标注条数）', [st.legend, st.annX.length], [K2_LEGEND, ANN60]);
    await click('trade-focus-toggle');
    await waitFor('!window.experimentSignals._tradeFocus', '聚焦关闭');
    await sleep(600);
    st = await state();
    check('K6 关闭 → 回单页截断默认视图（补拉缓存不混入）', st.win, WIN_TRUNC);
    // 失败注入须在新文档上做：同一文档里同窗口的补拉缓存还在，不会再发请求
    await ev(`sessionStorage.setItem('rj-smoke-ignore-range', '1'); true`);
    await nav(`${SIG_PAGE}?token=${TOK}&_cb=${Date.now()}`);
    const before = pageErrors.length;
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._tradeFocusError', '接口异常被显式捕获');
    await sleep(500);
    st = await state();
    check('K6 接口忽略 from/to → 不落缓存、状态条红色报错', [st.focusTicks, st.status.includes('⚠'), st.status.includes('未按时间范围过滤'), st.statusColor === 'rgb(248, 113, 113)'], [null, true, true, true]);
    check('K6 报错时只画基数里本就落在窗内的 ticks（伪响应不采用）', tickPts(st), ptsIn(ticksA.slice(0, 40), 60));
    check('K6 该步恰好一条 console.error（补拉失败）', pageErrors.length - before, 1);
    check('K6 报错文案是预期那条', pageErrors.slice(before).every((e) => e.includes('成交区间 ticks 补拉失败')), true);
    await ev(`sessionStorage.removeItem('rj-smoke-ignore-range'); true`);
    await click('trade-focus-toggle');
    await waitFor('!window.experimentSignals._tradeFocus', '聚焦关闭');
    await click('trade-focus-toggle');
    await waitFor('window.experimentSignals._tradeFocus && window.experimentSignals._tradeFocusTicks !== null', '关掉再开=重试成功');
    await sleep(500);
    st = await state();
    check('K6 关掉再开=重试成功（报错清除、窗口有 ticks）', [st.status.includes('⚠'), st.statusColor, st.legend['Buy']], [false, 'rgb(156, 163, 175)', K2_LEGEND['Buy']]);

    // ════════ K7：下拉切票（聚焦保持）+ 无成交信号票回落 ════════
    log('\n[K7] 聚焦开启中下拉切票：新票窗口随其成交锚重算；无成交信号票回落默认窗口并提示');
    await ev(`sessionStorage.setItem('rj-smoke-mode', 'dropdown'); true`);
    await nav(`${SIG_PAGE}?_cb=${Date.now()}`, DROPDOWN_READY);
    await click('trade-focus-toggle');
    await sleep(300);
    st = await state();
    check('K7 未选票时开启聚焦：模式开、无状态条', [st.focus, st.pressed, st.statusShown], [true, 'true', false]);
    const select = (addr) => ev(`(() => { const s = document.getElementById('token-selector'); s.value = ${JSON.stringify(addr)}; s.dispatchEvent(new Event('change')); return true; })()`);
    await select(TOK);
    await waitFor(`window.experimentSignals._lastToken && String(window.experimentSignals._lastToken.address).toLowerCase() === ${JSON.stringify(TOK)} && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '选案源票后聚焦窗口');
    await sleep(900);
    st = await state();
    check('K7 选案源票 → 直接按其成交锚聚焦（无需再点开关）', [st.token, st.win, st.x.bubble, st.status.startsWith(`成交 ${tradesA.length} 笔`)], [TOK, W60, expWin(60), true]);
    await select(tok2);
    await waitFor(`window.experimentSignals._lastToken && String(window.experimentSignals._lastToken.address).toLowerCase() === ${JSON.stringify(tok2.toLowerCase())}`, '切到第二票');
    await sleep(900);
    st = await state();
    check('K7 无成交信号票：状态条提示 + 回落默认窗口（未钉轴）+ 开关保持开启', [st.token, st.status, st.statusShown, st.win[2], st.focus, st.pressed, st.x.bubble], [tok2.toLowerCase(), '无成交信号 · 仍显示全部信号窗口', true, false, true, 'true', st.win.slice(0, 2)]);
    await select(TOK);
    await waitFor(`window.experimentSignals._lastToken && String(window.experimentSignals._lastToken.address).toLowerCase() === ${JSON.stringify(TOK)} && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '切回案源票');
    await sleep(900);
    st = await state();
    check('K7 切回案源票 → 聚焦窗口恢复', [st.win, st.status.startsWith(`成交 ${tradesA.length} 笔`)], [W60, true]);

    // ════════ K7b：截断基数 + 下拉切票（换票加载链把新票基数传给覆盖判定） ════════
    if (tok3) {
      log('\n[K7b] 截断基数 + 下拉切票：已覆盖窗尾的票零补拉 / 未覆盖的票补拉一次');
      await ev(`sessionStorage.setItem('rj-smoke-trunc', '1'); true`);
      await nav(`${SIG_PAGE}?_cb=${Date.now()}`, DROPDOWN_READY);
      await click('trade-focus-toggle');
      await select(tok3.address);
      await waitFor(`window.experimentSignals._lastToken && String(window.experimentSignals._lastToken.address).toLowerCase() === ${JSON.stringify(tok3.address.toLowerCase())} && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '切到前段成交票');
      await sleep(700);
      st = await state();
      check('K7b 截断基数已覆盖窗尾的票：零补拉请求、窗口=其成交锚 ±60s', [await ev('window.__smoke.tickReqs.length'), st.win, st.complete], [0, [...tok3.win, true], false]);
      await select(TOK);
      await waitFor(`window.experimentSignals._lastToken && String(window.experimentSignals._lastToken.address).toLowerCase() === ${JSON.stringify(TOK)} && window.experimentSignals._lastWindow && window.experimentSignals._lastWindow.pinned`, '切回案源票');
      await waitFor('window.experimentSignals._tradeFocusTicks !== null', '案源票补拉落缓存');
      await sleep(500);
      check('K7b 截断基数未覆盖窗尾的案源票：恰好补拉一次、from/to=窗口两端', await ev('window.__smoke.tickReqs'), [{ from: expWin(60)[0], to: expWin(60)[1] }]);
    } else {
      log('\n[K7b] 跳过：实验里找不到「成交在生命周期前段且 ticks>40」的票');
    }

    // ════════ K8 ════════
    log('\n[K8] 页面异常');
    const unexpected = pageErrors.filter((e) => !e.includes('成交区间 ticks 补拉失败'));
    check('K8 全程无未预期页面异常（K6 失败注入的那条除外）', unexpected, []);

    log(`\n${fail === 0 ? '✅' : '❌'} 成交聚焦冒烟：${pass} 通过 / ${fail} 失败`);
    if (fail) process.exitCode = 1;
  } finally { chrome.kill('SIGKILL'); }
})().catch((e) => { console.error('冒烟执行失败:', e); process.exit(1); });
