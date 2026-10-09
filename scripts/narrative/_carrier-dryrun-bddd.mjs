#!/usr/bin/env node
/**
 * subject_carrier（形象载体存在性，J1.29 候选题）dry-run —— bddd3578 标准路径票
 *
 * 背景（bddd3578 C/D/E 亏损票分析案）：C/D 35 票净 -2.85 共同病根=叙事主体无
 * 形象/梗载体；se 无形象桶（product_functional/event_hotspot/person…）全域 70 票
 * winR 17% 净 -5.37；C/D 29/35 票 strong_fit≥0.9 而 winR 7%——web3_fit 在蹭票上
 * 语义反向（判「组合体风格契合」非「主体被接纳」），J1.27 接纳门 fitMass 判据
 * 失效。本 dry-run 验证新题三档判定与盈亏的对齐度，不动生产题集/mapper。
 *
 * 方法（state 保真，J1.28 dry-run 同款）：线上 stage1_prompt.state 原文复用 +
 * buildStandardQuestions({includeBrandHijack, carrier: true}) + 只读
 * answers.subject_carrier.choice（纯观测）。
 *
 * 用法（182）：
 *   node scripts/narrative/_carrier-dryrun-bddd.mjs --smoke   # 冒烟 11 票（已知答案锚）
 *   node scripts/narrative/_carrier-dryrun-bddd.mjs           # 全量（标准路径票）
 * 断点续跑：data/carrier-dryrun-bddd.json 为 checkpoint，成功票自动跳过。
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');
const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
const { buildStandardQuestions, shouldIncludeBrandHijackCheck, JEV_QUESTIONS_VERSION } = await import('../../src/narrative/analyzer/llm/jev-questions.mjs');

const SMOKE = process.argv.includes('--smoke');
// 冒烟锚（bddd3578 已知票）：expect = 期望档；observe = 边界观察票（不判对错）
const SMOKE_ADDRS = [
  // improvised（脑补许愿形象——官方从未展示）
  { addr: '0xf5362fdf641d31e9ca1a9e6210ae193087167777', expect: 'improvised_entity', note: 'BNC「Why not BNC standing for Binance cat」binance 从未有过猫' },
  { addr: '0x67496bf3b731ba5450fa075759e284beaa747777', expect: 'improvised_entity', note: 'WECAT「WECHAT CAT SHOULD BE TENCENT」路人许愿' },
  { addr: '0xf8fb159187e05248d0405ff44198dea82c0c7777', expect: 'improvised_entity', note: 'SI「好像还没有发过SAFU INU」对未来发行的想象' },
  { addr: '0x60b9edaa1af7779e510ec24536149b4b6f9d7777', expect: 'improvised_entity', note: 'SAFUINU 同语料簇' },
  // existing（形象已在语料/官方本体真实出现）
  { addr: '0x5becb5cb498b62e5986f5693bdbe4e41b79e7777', expect: 'existing_entity', note: 'bCAT 币安 APP 钱包横幅演示页置顶 meme 头像' },
  { addr: '0xcbe750b8f1c1bc023ebc5f35f0a7784b7adf7777', expect: 'existing_entity', note: 'Cherry 雷军收养的真实狗，配图出现（票亏但载体存在——死因是时效）' },
  { addr: '0xd1398a2ce4019349d89cf0d54b98902cfe337777', expect: 'existing_entity', note: 'Mur mur猫 meme 互联网已有形象（E 赢票 +1.92）' },
  { addr: '0xa67a200c0beade623e19887474594ea9dcef7777', expect: 'existing_entity', note: '小年 pfp cult 头像形象（E 赢票 +1.63）' },
  // no_visual（不以形象为存在形式）
  { addr: '0xfd7475f24c6fdec2739711c6c866203c719d7777', expect: 'no_visual_entity', note: '通透人生 抖音抽象概念梗（E 赢票 +0.55——门矩阵代价样本）' },
  { addr: '0xe485bb477f9a39bb5cabbec8c6ed56e013f67777', expect: 'no_visual_entity', note: '刹车板 尊界S800 热点部件（E 赢票 +0.23）' },
  // 边界观察
  { addr: '0xbc810336b89a36dd7373fc49e9f52d6764897777', observe: true, note: 'CHONK Mistral Large 4 昵称 Le Chonk——chonk 是著名猫梗但模型非猫' },
  { addr: '0xbd888f369e6c3b3abc5c60a43f1cea6c7c8d7777', observe: true, note: '达摩 CZ 船名 DA MOON 谐音——达摩是千年文化形象但事件是谐音嫁接' },
];

const analysis = JSON.parse(fs.readFileSync(resolve(__dirname, '../../data/analysis-bddd3578-narrative.json'), 'utf8')).rows;
const baseByAddr = new Map(analysis.map(r => [r.addr, r]));

const OUT_FILE = resolve(__dirname, '../../data/carrier-dryrun-bddd.json');
const out = new Map(); // addr -> record（成功票 carrier 非 null；断点续跑只收成功票）
if (fs.existsSync(OUT_FILE)) {
  for (const rec of JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'))) {
    if (rec && rec.addr && rec.carrier != null) out.set(rec.addr, rec);
  }
}

const flush = () => fs.writeFileSync(OUT_FILE, JSON.stringify([...out.values()], null, 1));

async function askOne(row) {
  let state = null, stateSrc = 'online';
  try {
    const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
    state = p?.state || null;
  } catch { /* 旧行非 JSON */ }
  const base = baseByAddr.get(row.token_address) || {};
  const rec = {
    addr: row.token_address, symbol: row.token_symbol, net: base.net ?? null,
    cat: base.jevCategory ?? null, tokenCat: base.tokenCategory ?? null,
    tier: base.magnitudeTier ?? null, refMem: base.referentMemeability ?? null,
  };
  if (!state) return { ...rec, carrier: null, probs: null, stateSrc: 'rebuilt-no-state' };
  const includeBrandHijack = shouldIncludeBrandHijackCheck(row.token_symbol, row.raw_api_data?.name || '');
  try {
    const q = buildStandardQuestions({ includeBrandHijack, carrier: true });
    const r = await JevClient.ask(state, q, { label: `carrier:${row.token_symbol}` });
    const a = r.answers?.subject_carrier;
    return { ...rec, carrier: a?.choice ?? null, probs: a?.probabilities ?? null, stateSrc };
  } catch (e) {
    return { ...rec, carrier: null, probs: null, stateSrc: 'err:' + String(e.message).slice(0, 80) };
  }
}

async function main() {
  const supabase = NarrativeRepository.getSupabase();
  // 票集：SMOKE 模式取锚地址；全量取 analysis 全票（标准路径 = jevCategory 非空）
  const targets = SMOKE
    ? SMOKE_ADDRS.map(s => baseByAddr.get(s.addr)).filter(Boolean).map(r => r.addr)
    : analysis.filter(r => r.jevCategory != null).map(r => r.addr);
  console.log(`目标票数: ${targets.length}${SMOKE ? '（冒烟）' : `（标准路径 / 全 ${analysis.length}）`} 已有 checkpoint ${[...targets].filter(a => out.has(a)).length} 问题集 ${JEV_QUESTIONS_VERSION}+carrier`);

  const rows = [];
  for (let i = 0; i < targets.length; i += 50) {
    const { data } = await supabase.from('token_narrative')
      .select('token_address, token_symbol, is_valid, analyzed_at, raw_api_data, stage1_prompt')
      .in('token_address', targets.slice(i, i + 50));
    rows.push(...(data || []));
  }
  // 同地址多行去重：is_valid 优先，同则 analyzed_at 最新（与线上 analyze() 缓存命中同口径）
  const dedup = new Map();
  for (const r of rows) {
    const prev = dedup.get(r.token_address);
    if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) dedup.set(r.token_address, r);
  }
  const todo0 = targets.map(a => dedup.get(a)).filter(Boolean);

  // 多 pass：上游 529 过载时 JevClient 内置 2 次短退避不够，失败票隔 60s 补跑（最多 4 pass）
  for (let pass = 1; pass <= 4; pass++) {
    const todo = todo0.filter(r => {
      const rec = out.get(r.token_address);
      return !rec || rec.carrier == null; // 成功票已收即跳过，err 票补跑
    });
    if (!todo.length) break;
    if (pass > 1) {
      console.log(`pass ${pass}: 补跑 ${todo.length} 张失败票（60s 冷却后）`);
      await new Promise(z => setTimeout(z, 60000));
    }
    let done = 0;
    for (const row of todo) {
      const rec = await askOne(row);
      if (rec.carrier != null) out.set(rec.addr, rec); // 只收成功票进 checkpoint
      else out.set(rec.addr, rec); // err 也暂存（flush 供诊断），下 pass 重跑覆盖
      if (++done % 10 === 0) { console.log(`  pass${pass} ${done}/${todo.length}`); flush(); }
    }
    flush();
  }
  flush();

  const results = targets.map(a => out.get(a)).filter(Boolean);

  // ── 冒烟对照 ──
  if (SMOKE) {
    console.log('\n===== 冒烟对照 =====');
    for (const s of SMOKE_ADDRS) {
      const rec = out.get(s.addr);
      const got = rec?.carrier ?? '(无)';
      const mark = s.observe ? '[观察]' : (got === s.expect ? '[✓]' : '[✗]');
      console.log(`${mark} ${String(rec?.symbol ?? '?').padEnd(10)} → ${got.padEnd(20)} ${s.note}`);
      if (rec?.probs) console.log(`     probs: ${JSON.stringify(rec.probs)}`);
    }
    return;
  }

  // ── 统计 ──
  const sum = a => a.reduce((x, y) => x + y, 0);
  const fmt = (v, d = 3) => v == null || !isFinite(v) ? 'null' : v.toFixed(d);
  const ok = results.filter(r => r.carrier != null);

  console.log(`\n成功 ${ok.length}/${results.length}（失败 ${results.length - ok.length}）`);
  console.log('\n===== carrier 三档 × 盈亏（全域）=====');
  const byCarrier = new Map();
  for (const r of ok) { if (!byCarrier.has(r.carrier)) byCarrier.set(r.carrier, []); byCarrier.get(r.carrier).push(r); }
  for (const [k, l] of [...byCarrier.entries()].sort((a, b) => sum(b[1].map(r => r.net)) - sum(a[1].map(r => r.net)))) {
    const w = l.filter(r => r.net > 0).length;
    console.log(`${k.padEnd(20)} ${String(l.length).padStart(3)} 票 winR ${fmt(100 * w / l.length, 0).padStart(3)}% 净 ${fmt(sum(l.map(r => r.net))).padStart(8)}`);
  }

  console.log('\n===== carrier × jevCategory 矩阵（净额 / 票数）=====');
  const cats = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'W'];
  const head = '档                  ' + cats.map(c => c.padStart(12)).join('');
  console.log(head);
  for (const k of ['existing_entity', 'improvised_entity', 'no_visual_entity']) {
    const cells = cats.map(c => {
      const l = ok.filter(r => r.carrier === k && r.cat === c);
      return l.length ? `${fmt(sum(l.map(r => r.net)), 1)}/${l.length}`.padStart(12) : ''.padStart(12);
    });
    console.log(k.padEnd(20) + cells.join(''));
  }

  // ── 门矩阵 ──
  const cdBlocked = r => ['C', 'D'].includes(r.cat) && r.carrier !== 'existing_entity';
  const GATES = {
    'M1 C/D+非existing': cdBlocked,
    'M2 M1+E+no_visual': r => cdBlocked(r) || (r.cat === 'E' && r.carrier === 'no_visual_entity'),
    'M3 M1+E+非existing': r => cdBlocked(r) || (r.cat === 'E' && r.carrier !== 'existing_entity'),
    'M4 A/C/D/E+no_visual': r => ['A', 'C', 'D', 'E'].includes(r.cat) && r.carrier === 'no_visual_entity',
    'M5 A/C/D/E+非existing': r => ['A', 'C', 'D', 'E'].includes(r.cat) && r.carrier !== 'existing_entity',
    'M6 全域+no_visual': r => r.carrier === 'no_visual_entity',
  };
  console.log('\n===== 门矩阵（净效应 = −Σ拦票net；正=避亏净收益）=====');
  for (const [name, fn] of Object.entries(GATES)) {
    const blocked = ok.filter(fn);
    if (!blocked.length) { console.log(`${name.padEnd(24)} 拦 0 票`); continue; }
    const lost = sum(blocked.filter(r => r.net < 0).map(r => -r.net));
    const given = sum(blocked.filter(r => r.net > 0).map(r => r.net));
    const wins = blocked.filter(r => r.net > 0);
    console.log(`${name.padEnd(24)} 拦 ${String(blocked.length).padStart(3)} 票 避亏 +${fmt(lost, 2)} 放弃赢 −${fmt(given, 2)} 净 +${fmt(lost - given, 2)}` +
      (wins.length ? ` | 误伤赢票: ${wins.slice(0, 6).map(r => `${r.symbol}(${fmt(r.net, 2)})`).join(' ')}${wins.length > 6 ? ' …' : ''}` : ''));
  }

  // ── C/D 拦截明细（主目标）──
  console.log('\n===== M1 拦截明细（C/D 全票）=====');
  for (const r of ok.filter(cdBlocked).sort((a, b) => a.net - b.net)) {
    console.log(`  [拦] ${String(r.symbol).padEnd(12)} ${r.carrier.padEnd(20)} net=${fmt(r.net, 3)} ${r.addr}`);
  }
  const cdPass = ok.filter(r => ['C', 'D'].includes(r.cat) && r.carrier === 'existing_entity');
  console.log('===== C/D 放行明细（existing）=====');
  for (const r of cdPass.sort((a, b) => a.net - b.net)) {
    console.log(`  [放] ${String(r.symbol).padEnd(12)} net=${fmt(r.net, 3)} ${r.addr}`);
  }

  const noScore = results.filter(r => r.carrier == null);
  if (noScore.length) console.log(`\n无判定: ${noScore.length} 票（${noScore.map(r => r.stateSrc).filter((v, i, a) => a.indexOf(v) === i).join('; ')}`);
  console.log('\n导出: data/carrier-dryrun-bddd.json');
}

main().catch(e => { console.error(e); process.exit(1); });
