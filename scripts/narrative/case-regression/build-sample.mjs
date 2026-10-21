#!/usr/bin/env node
/**
 * 叙事抽样测试集构建器（case 回归集的姊妹资产，2026-10-21 建）。
 *
 * 从指定实验的 experiment_tokens 并集出发，按 token_profiles.max_change_percent
 * （峰值涨幅，BNB 计价可用价链口径）分层抽样，写 sample-sets/<name>.json 供
 * run-sample.mjs 重析对拍。涨幅已知池（max_change_percent 非空）才参与抽样
 * （用户裁定 2026-10-21：随机层同样仅从涨幅已知池抽，保证全部票带涨幅可对拍）。
 *
 * 在 182 跑（拉 experiment_tokens 全量 + token_profiles 批查）：
 *   npm run narrative-sample-build -- --exps <id1>,<id2>,<id3> --name 2026-10-21-three-exp-180 \
 *     --top 60 --bottom 60 --random 60 --seed 20261021
 *
 * 抽样规则（分层纯函数 stratifySample 在同目录 lib.mjs，单测锁定）：
 *   - top：max 降序前 N（并列 final 降序、addr 升序定序）
 *   - bottom：max 升序前 N（并列 final 升序——max=0 尘票里最终跌最狠的优先、addr 升序）
 *   - random：剩余池 mulberry32(seed) 洗牌取 N（seed 落盘，样本可复现）
 *   - 排除 case 回归集 fixtures 已收录地址（一票一 case，addr 全局唯一）
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../../..'));
dotenv.config({ path: resolve(__dirname, '../../../config/.env') });

const { stratifySample } = await import('./lib.mjs');
const dbModule = await import('../../../src/services/dbManager.js');
const { dbManager } = dbModule;

const SETS_DIR = resolve(__dirname, 'sample-sets');
const FIXTURES_PATH = resolve(__dirname, 'fixtures.json');
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function parseArgs(argv) {
  const out = { exps: [], name: '', top: 50, bottom: 50, random: 50, seed: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--exps') out.exps = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--top') out.top = parseInt(argv[++i], 10);
    else if (a === '--bottom') out.bottom = parseInt(argv[++i], 10);
    else if (a === '--random') out.random = parseInt(argv[++i], 10);
    else if (a === '--seed') out.seed = parseInt(argv[++i], 10);
    else { console.error(`未知参数: ${a}`); process.exit(1); }
  }
  if (!out.exps.length || !out.name) {
    console.error('用法: build-sample.mjs --exps <id,...> --name <set-name> [--top 50] [--bottom 50] [--random 50] [--seed N]');
    process.exit(1);
  }
  if (out.seed === null) out.seed = Math.floor(Math.random() * 2 ** 31);
  return out;
}

async function fetchTokensPaged(client, experimentId) {
  const rows = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await client
      .from('experiment_tokens')
      .select('token_address,token_symbol,platform,status')
      .eq('experiment_id', experimentId)
      .order('token_address', { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`experiment_tokens 拉取失败: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchProfiles(client, addrs) {
  const out = new Map();
  for (let i = 0; i < addrs.length; i += 100) {
    const { data, error } = await client
      .from('token_profiles')
      .select('token_address,max_change_percent,final_change_percent,category,peak_mcap_usd')
      .in('token_address', addrs.slice(i, i + 100));
    if (error) throw new Error(`token_profiles 拉取失败: ${error.message}`);
    for (const r of data ?? []) out.set(r.token_address.toLowerCase(), r);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await (dbManager.init ? dbManager.init() : undefined);
  const client = dbManager.getClient();

  // 1) 实验并集（addr → 首个非空 symbol / platform 集 / 来源实验集）
  const union = new Map();
  const perExpCounts = {};
  for (const exp of args.exps) {
    const rows = await fetchTokensPaged(client, exp);
    perExpCounts[exp] = rows.length;
    for (const r of rows) {
      const a = (r.token_address || '').toLowerCase();
      if (!ADDR_RE.test(a)) continue;
      if (!union.has(a)) union.set(a, { symbol: '', platforms: new Set(), exps: new Set(), status: new Set() });
      const u = union.get(a);
      if (!u.symbol && r.token_symbol) u.symbol = r.token_symbol;
      if (r.platform) u.platforms.add(r.platform);
      if (r.status) u.status.add(r.status);
      u.exps.add(exp.slice(0, 8));
    }
    console.log(`exp ${exp.slice(0, 8)}: tokens=${rows.length}`);
  }
  console.log(`实验并集: ${union.size}`);

  // 2) 涨幅画像
  const addrs = [...union.keys()];
  const profiles = await fetchProfiles(client, addrs);
  let withGain = 0;
  const pool = [];
  for (const a of addrs) {
    const p = profiles.get(a);
    if (p && p.max_change_percent !== null && p.max_change_percent !== undefined) {
      withGain++;
      pool.push({
        addr: a,
        max: Number(p.max_change_percent),
        final: p.final_change_percent === null || p.final_change_percent === undefined ? null : Number(p.final_change_percent),
        cat: p.category ?? null,
        peakMcapUsd: p.peak_mcap_usd ?? null,
      });
    }
  }
  console.log(`token_profiles 涨幅已知池: ${withGain}/${addrs.length}`);

  // 3) 排除 case 回归集已收录票
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const caseAddrs = new Set((fixtures.cases ?? []).map((c) => c.addr.toLowerCase()));
  const poolBefore = pool.length;
  const gainPool = pool.filter((p) => !caseAddrs.has(p.addr));
  console.log(`排除回归集已收录 ${poolBefore - gainPool.length} 票 → 抽样池 ${gainPool.length}`);

  // 4) 分层抽样（纯函数，lib.mjs 单测锁定）
  const { top, bottom, random } = stratifySample(gainPool, { top: args.top, bottom: args.bottom, random: args.random, seed: args.seed });

  const entries = [];
  const push = (stratum, list) => {
    list.forEach((p, i) => {
      const u = union.get(p.addr);
      entries.push({
        sampleId: `${stratum.toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
        stratum, addr: p.addr,
        symbol: u.symbol, maxGainPct: p.max, finalGainPct: p.final,
        profileCat: p.cat, peakMcapUsd: p.peakMcapUsd,
        platform: [...u.platforms].join('|'), srcExps: [...u.exps].join('|'), tokenStatus: [...u.status].join('|'),
      });
    });
  };
  push('top', top); push('bottom', bottom); push('random', random);

  // 5) 校验 + 落盘（tmp+rename 原子写）
  const seen = new Set();
  for (const e of entries) {
    if (!ADDR_RE.test(e.addr)) { console.error(`addr 非 0x40hex: ${e.addr}`); process.exit(1); }
    if (seen.has(e.addr)) { console.error(`addr 重复: ${e.addr}`); process.exit(1); }
    seen.add(e.addr);
  }
  const doc = {
    description: '叙事抽样测试集（case 回归集姊妹资产）：按峰值涨幅分层抽样，run-sample.mjs 整链重析出评级分布，供改题集前后对拍与「评级 vs 涨幅」相关性分析。抽样规则见 build-sample.mjs 头注。',
    setName: args.name,
    builtAt: new Date().toISOString(),
    experiments: args.exps,
    unionSize: union.size,
    gainPoolSize: gainPool.length,
    excludedCaseAddrs: poolBefore - gainPool.length,
    seed: args.seed,
    gainMetric: 'token_profiles.max_change_percent（峰值涨幅，BNB 计价可用价链）',
    counts: { top: top.length, bottom: bottom.length, random: random.length, total: entries.length },
    gainRanges: {
      top: { maxMin: top.length ? top[top.length - 1].max : null, maxMax: top.length ? top[0].max : null },
      bottom: { maxMin: bottom.length ? bottom[0].max : null, maxMax: bottom.length ? bottom[bottom.length - 1].max : null },
    },
    samples: entries,
  };
  mkdirSync(SETS_DIR, { recursive: true });
  const outPath = resolve(SETS_DIR, `${args.name}.json`);
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmp, outPath);
  console.log(`抽样完成 → ${outPath}`);
  console.log(`  top${top.length}: max ∈ [${doc.gainRanges.top.maxMin?.toFixed(1)}, ${doc.gainRanges.top.maxMax?.toFixed(1)}]%`);
  console.log(`  bottom${bottom.length}: max ∈ [${doc.gainRanges.bottom.maxMin?.toFixed(1)}, ${doc.gainRanges.bottom.maxMax?.toFixed(1)}]%`);
  console.log(`  random${random.length}（seed=${args.seed}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
