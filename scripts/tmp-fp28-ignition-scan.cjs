#!/usr/bin/env node
/**
 * 一次性脚本（不进 git）：FP28 点火形状攒批扫描 —— 182 跑（重查询不本地跑）
 * 案源：bt-v164 0xb6ee…7777 被 FP28·早窗启动失败死盘拒——触发腿 buy_0 最早臂
 * 被「点火买单本身」触发（buyVolumeBnb 跨 1B 里程碑），锚前 7s 窗数到的 2 笔
 * 就是点火单（0.294B），burst 本体 +99s 才到。N 口径把「大额点火」与「尘埃尾」
 * 等同。本扫描量化：FP28 拒面里「点火金额豁免候选面」（尾 7s 买 BNB ≥ 线）的
 * 规模与前向结局，供攒批裁定。
 *
 * 口径：
 * - 信号集=BUY 且 metadata.factorCheck.arms 含 'launch_fail_dead'（FP28 拒；
 *   arms==['launch_fail_dead'] 记「纯」，其余记「混合」）
 * - 尾 7s 窗=引擎 nearTail7 镜像 (锚-7s, 锚] 左开右闭（bpInWin 同款，锚行计入）
 * - 点火捆绑=尾 7s 窗内同块等额（相对差 <1e-6）≥2 笔——豁免线的风险面标记
 * - 前向 +0~120s / +120~300s（fwdSec 可调）买 N/BNB/独立钱包数（wallet=sender||trader）
 * - burst 本体=前向 120s 内买 ≥5 笔 ∧ ≥0.3B
 * - 价格=可靠价（!price_outlier）；entry=锚时刻最后可靠价；peak/final=前向窗内
 *   max/last；peakPct 为反事实捕获上界（诚实标注：还要过 cheat/BP 门，非可实现盈亏）
 * 用法：node scripts/tmp-fp28-ignition-scan.cjs --exp <id>[,<id>...] [--line 0.25] [--fwdSec 300]
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXP_IDS = String(argOf('--exp', '9e9163de-a677-4d39-9c33-9ec9df05e400')).split(',');
const LINE = parseFloat(argOf('--line', '0.25'));
const FWD_SEC = parseInt(argOf('--fwdSec', '300'), 10);

const isBuy = (r) => String(r.trade_type || '').toLowerCase() === 'buy';
const walletOf = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

(async () => {
  const db = dbManager.getClient();

  for (const expId of EXP_IDS) {
    const exp = await db.from('experiments').select('experiment_name').eq('id', expId).limit(1);
    const expName = (exp.data && exp.data[0] && exp.data[0].experiment_name) || expId.slice(0, 8);
    console.log(`\n########## ${expName} (${expId}) ##########`);

    // 1) 分页拉 BUY 信号（token/时间/metadata），客户端过滤 FP28 拒
    const raw = [];
    let total = 0, withFc = 0;
    for (let offset = 0; ; offset += 1000) {
      const page = await db.from('strategy_signals')
        .select('token_address,created_at,metadata')
        .eq('experiment_id', expId).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true })
        .range(offset, offset + 999);
      if (page.error) throw new Error(page.error.message);
      total += page.data.length;
      for (const s of page.data) {
        const m = s.metadata && typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
        if (!m || !m.factorCheck) continue;
        withFc++;
        const arms = m.factorCheck.arms;
        if (!Array.isArray(arms) || !arms.includes('launch_fail_dead')) continue;
        raw.push({
          token: String(s.token_address || '').toLowerCase(),
          anchor: new Date(s.created_at),
          pure: arms.length === 1,
          arms,
          legId: (m.signalGate && m.signalGate.legId) || '?',
        });
      }
      if (page.data.length < 1000) break;
    }
    console.log(`BUY 信号 ${total}，带 factorCheck ${withFc}，FP28 拒 ${raw.length}（纯 ${raw.filter(r => r.pure).length} / 混合 ${raw.filter(r => !r.pure).length}）`);
    if (!raw.length) continue;

    // 同票同锚去重（多腿同 tick fire 只计一次）
    const seen = new Set();
    const sigs = raw.filter(r => {
      const k = `${r.token}|${Math.round(r.anchor.getTime() / 2000)}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (sigs.length !== raw.length) console.log(`同票同锚去重: ${raw.length} → ${sigs.length}`);

    // 2) per 信号: 拉锚 ±(30s / FWD_SEC) ticks, 算形状
    const rows = [];
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i];
      const a = s.anchor.getTime();
      const from = new Date(a - 30_000).toISOString();
      const to = new Date(a + FWD_SEC * 1000).toISOString();
      const q = await db.from('wss_price_ticks')
        .select('block_number,log_index,block_time,trade_type,bnb_amount,price_bnb,price_outlier,platform,sender_address,trader_address')
        .eq('token_address', s.token).gte('block_time', from).lte('block_time', to)
        .order('block_time', { ascending: true }).limit(2000);
      if (q.error) throw new Error(q.error.message);
      const ticks = q.data;
      if (!ticks.length) { rows.push({ ...s, t7N: null }); continue; }

      // 尾 7s（(a-7s, a]，锚行计入）+ 同块等额捆绑
      let t7N = 0, t7Bnb = 0; const t7Buys = [];
      // 前向两段
      let f1N = 0, f1Bnb = 0; const f1Wallets = new Set();
      let f2N = 0, f2Bnb = 0;
      // 可靠价路径
      let entry = null, peak = null, final = null;
      for (const t of ticks) {
        const ts = new Date(t.block_time).getTime();
        if (isBuy(t)) {
          const b = t.bnb_amount || 0;
          if (ts > a - 7000 && ts <= a) { t7N++; t7Bnb += b; t7Buys.push({ blk: t.block_number, bnb: b }); }
          else if (ts > a && ts <= a + 120_000) { f1N++; f1Bnb += b; f1Wallets.add(walletOf(t)); }
          else if (ts > a + 120_000 && ts <= a + FWD_SEC * 1000) { f2N++; f2Bnb += b; }
        }
        if (t.price_bnb && !t.price_outlier) {
          if (ts <= a) entry = t.price_bnb;
          else { if (peak === null || t.price_bnb > peak) peak = t.price_bnb; final = t.price_bnb; }
        }
      }
      // 同块等额 ≥2（点火捆绑标记）
      const byBlk = new Map();
      for (const b of t7Buys) byBlk.set(b.blk, (byBlk.get(b.blk) || []).concat(b.bnb));
      let igBundledBnb = 0;
      for (const [, arr] of byBlk) {
        if (arr.length < 2) continue;
        const mx = Math.max(...arr);
        if (arr.every(x => Math.abs(x - mx) / Math.max(mx, 1e-12) < 1e-6)) igBundledBnb += arr.reduce((x, y) => x + y, 0);
      }
      const entryPct = (peak !== null && entry) ? (peak / entry - 1) * 100 : null;
      const finalPct = (final !== null && entry) ? (final / entry - 1) * 100 : null;
      rows.push({
        ...s, t7N, t7Bnb: +t7Bnb.toFixed(4), igBundledBnb: +igBundledBnb.toFixed(4),
        f1N, f1Bnb: +f1Bnb.toFixed(3), f1Wallets: f1Wallets.size, f2N, f2Bnb: +f2Bnb.toFixed(3),
        burst: f1N >= 5 && f1Bnb >= 0.3,
        platform: ticks[0].platform || '?',
        entryPct: entryPct === null ? null : +entryPct.toFixed(1),
        finalPct: finalPct === null ? null : +finalPct.toFixed(1),
      });
      if ((i + 1) % 20 === 0) console.log(`  … ${i + 1}/${sigs.length}`);
    }

    const ok = rows.filter(r => r.t7N !== null);
    const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const t7b = ok.map(r => r.t7Bnb);
    console.log(`\nt7Bnb 分布: p50=${med(t7b)} p75=${med(t7b.filter(x => x >= med(t7b)))} max=${Math.max(...t7b)}（豁免线=${LINE}）`);

    const grp = (name, list) => {
      const n = list.length; if (!n) return console.log(`${name}: 0 票`);
      const peaks = list.map(r => r.entryPct).filter(v => v !== null);
      const finals = list.map(r => r.finalPct).filter(v => v !== null);
      const win = finals.filter(v => v > 0).length;
      const bundled = list.filter(r => r.igBundledBnb > 0).length;
      console.log(`${name}: ${n} 票 | burst 成波率 ${(list.filter(r => r.burst).length / n * 100).toFixed(0)}% | 峰值pct 中位 ${med(peaks)} / 均值 ${(peaks.reduce((x, y) => x + y, 0) / peaks.length).toFixed(1)} | 终值>0 ${win}/${finals.length} | Σ峰值捕获上界(0.2B仓) ${(peaks.reduce((x, y) => x + Math.max(y, 0), 0) * 0.2 / 100).toFixed(3)} | Σ终值 ${((finals.reduce((x, y) => x + y, 0)) * 0.2 / 100).toFixed(3)} | 点火含捆绑 ${bundled}`);
    };
    grp(`组A t7Bnb≥${LINE}（豁免候选面）`, ok.filter(r => r.t7Bnb >= LINE));
    grp(`组B t7Bnb<${LINE}（FP28 原域）`, ok.filter(r => r.t7Bnb < LINE));

    console.log(`\n组A 明细（峰值降序 top25）：`);
    const A = ok.filter(r => r.t7Bnb >= LINE).sort((x, y) => (y.entryPct || -1e9) - (x.entryPct || -1e9));
    console.log('  token      时间(UTC)         leg       t7N  t7Bnb  捆绑   f1N  f1Bnb  f1钱包  峰值%  终值%  burst 平台');
    for (const r of A.slice(0, 25)) {
      console.log(`  ${r.token.slice(0, 10)} ${r.anchor.toISOString().slice(5, 19)} ${String(r.legId).padEnd(9)} ${String(r.t7N).padStart(3)} ${String(r.t7Bnb).padStart(6)} ${String(r.igBundledBnb).padStart(5)} ${String(r.f1N).padStart(4)} ${String(r.f1Bnb).padStart(6)} ${String(r.f1Wallets).padStart(5)} ${String(r.entryPct).padStart(6)} ${String(r.finalPct).padStart(6)}  ${r.burst ? 'Y' : 'n'}   ${r.platform}`);
    }
    // 全量明细落盘（182 本地文件，供追查）
    const fs = require('fs');
    const out = `/tmp/fp28-ignition-${expId.slice(0, 8)}.json`;
    fs.writeFileSync(out, JSON.stringify(ok, null, 1));
    console.log(`全量明细 → ${out}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
