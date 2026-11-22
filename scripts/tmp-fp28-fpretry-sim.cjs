#!/usr/bin/env node
/**
 * 一次性脚本（不进 git）：FP28 拒后重试机制模拟 —— 182 跑
 * 用户提案：信号被因子过滤层（FP）拒后可再发两次（策略侧机制）。
 * 模拟形状 A（门内挂起重评，不重评触发条件、不等 T110）：FP 拒后，在后续
 * 「下一 tick、下下 tick」（≤+15s，fpRetry=2）以新时刻为锚重评 FP28 三腿，
 * 任一次翻转 → 救回，入场价=重评 tick 价。
 * 对照形状 B（现行 T110 3s 冷却下真再发射）：重试锚须 ≥a+3s——条件衰减后
 * 多半已死，量化其救援率差。
 * 假设（诚实标注）：不重评触发条件（+2s 内因子慢变近似恒真）；重评过 FP 后
 * 仍须过 cheat/BP 门（Jev），此处不模拟=上界；ath/age 口径=可靠价 vs
 * floor(平台常量, 滚动最低, 首可靠价)。
 * 用法：node scripts/tmp-fp28-fpretry-sim.cjs --exp <id>[,<id>...] [--fwdSec 300]
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const EXP_IDS = String(argOf('--exp', '9e9163de-a677-4d39-9c33-9ec9df05e400')).split(',');
const FWD_SEC = parseInt(argOf('--fwdSec', '300'), 10);
const RETRY_HORIZON_MS = 15_000;
const FLOOR_CONST = { flap: 5.546e-9, fourmeme: 4.496173469e-9 };

const isBuy = (r) => String(r.trade_type || '').toLowerCase() === 'buy';

(async () => {
  const db = dbManager.getClient();

  for (const expId of EXP_IDS) {
    const exp = await db.from('experiments').select('experiment_name').eq('id', expId).limit(1);
    console.log(`\n########## ${(exp.data[0] || {}).experiment_name || expId.slice(0, 8)} ##########`);

    // 1) FP28 拒信号（同前口径）
    const raw = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await db.from('strategy_signals').select('token_address,created_at,metadata')
        .eq('experiment_id', expId).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(offset, offset + 999);
      if (page.error) throw new Error(page.error.message);
      for (const s of page.data) {
        const m = s.metadata && typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
        const arms = m && m.factorCheck && m.factorCheck.arms;
        if (!Array.isArray(arms) || !arms.includes('launch_fail_dead')) continue;
        raw.push({ token: String(s.token_address || '').toLowerCase(), anchor: new Date(s.created_at).getTime(), pure: arms.length === 1 });
      }
      if (page.data.length < 1000) break;
    }
    const seen = new Set();
    const sigs = raw.filter(r => { const k = `${r.token}|${Math.round(r.anchor / 2000)}`; if (seen.has(k)) return false; seen.add(k); return true; });
    console.log(`FP28 拒 ${raw.length} → 去重 ${sigs.length}`);

    // 2) per 信号: token_create + 全窗 ticks（create → a+FWD）
    const createCache = new Map();
    const out = [];
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i];
      if (!createCache.has(s.token)) {
        const c = await db.from('wss_events').select('block_time').eq('kind', 'token_create')
          .eq('token_address', s.token).limit(1);
        createCache.set(s.token, c.data[0] ? new Date(c.data[0].block_time).getTime() : null);
      }
      const create = createCache.get(s.token);
      if (!create) { out.push({ ...s, err: 'no_create' }); continue; }
      const q = await db.from('wss_price_ticks')
        .select('block_number,log_index,block_time,trade_type,bnb_amount,price_bnb,price_outlier,platform')
        .eq('token_address', s.token)
        .gte('block_time', new Date(create - 1000).toISOString())
        .lte('block_time', new Date(s.anchor + FWD_SEC * 1000).toISOString())
        .order('block_time', { ascending: true }).limit(3000);
      if (q.error) throw new Error(q.error.message);
      const ticks = q.data.map(t => ({ ts: new Date(t.block_time).getTime(), buy: isBuy(t), bnb: t.bnb_amount || 0, px: (!t.price_outlier && t.price_bnb) ? t.price_bnb : null, platform: t.platform }));
      const floorBase = FLOOR_CONST[ticks[0] && ticks[0].platform] || FLOOR_CONST.fourmeme;

      // 锚前可靠价序列工具
      const fp28Verdict = (t) => {
        // t7N
        let n = 0;
        for (const k of ticks) { if (k.ts > t - 7000 && k.ts <= t && k.buy) n++; }
        // ath vs floor
        let hi = null, roll = null, first = null;
        for (const k of ticks) {
          if (k.ts > t || !k.px) continue;
          if (hi === null || k.px > hi) hi = k.px;
          if (roll === null || k.px < roll) roll = k.px;
          if (first === null) first = k.px;
        }
        const floor = Math.min(floorBase, roll != null ? roll : floorBase, first != null ? first : floorBase);
        const ath = hi != null && floor > 0 ? (hi / floor - 1) * 100 : null;
        const age = (t - create) / 1000;
        const reject = ath !== null && ath < 40 && age < 90 && n <= 2;
        return { n, ath: ath === null ? null : +ath.toFixed(1), age: +age.toFixed(0), reject, flipBy: !reject ? (n > 2 ? 't7N' : (age >= 90 ? 'age' : 'ath')) : null };
      };
      const lastPx = (t) => { let p = null; for (const k of ticks) { if (k.ts <= t && k.px) p = k.px; } return p; };
      const fwd = (t) => {
        let peak = null, fin = null;
        for (const k of ticks) { if (k.ts > t && k.px) { if (peak === null || k.px > peak) peak = k.px; fin = k.px; } }
        return { peak, fin };
      };

      const v0 = fp28Verdict(s.anchor);
      // 重试锚：a 后前 2 个不同 block_time（≤+15s）
      const retryTs = [];
      for (const k of ticks) {
        if (k.ts > s.anchor && k.ts <= s.anchor + RETRY_HORIZON_MS && !retryTs.includes(k.ts)) retryTs.push(k.ts);
        if (retryTs.length >= 2) break;
      }
      const entryA = lastPx(s.anchor);
      let rescued = null;
      for (const t of retryTs) {
        const v = fp28Verdict(t);
        if (!v.reject) { rescued = { t, ...v, entryT: lastPx(t), ...fwd(t) }; break; }
      }
      const baseFwd = fwd(s.anchor);
      out.push({
        ...s, pure: s.pure,
        v0: { n: v0.n, ath: v0.ath, age: v0.age },
        retryN: retryTs.length,
        rescued,
        t110Rescued: (() => {
          for (const t of retryTs) {
            if (t < s.anchor + 3000) continue;
            const v = fp28Verdict(t);
            if (!v.reject) return true;
          }
          return false;
        })(),
        entryA, basePeak: baseFwd.peak, baseFin: baseFwd.fin,
      });
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${sigs.length}`);
    }

    // 3) 汇总
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(1) : null; };
    const pct = (p, e) => (p && e ? +((p / e - 1) * 100).toFixed(1) : null);
    const sum = (a) => +a.reduce((x, y) => x + y, 0).toFixed(3);
    const report = (name, list) => {
      const r = list.filter(x => x.rescued), nr = list.filter(x => !x.rescued && !x.err);
      const ds = r.map(x => +((x.rescued.t - x.anchor) / 1000).toFixed(1));
      const costs = r.map(x => pct(x.rescued.entryT, x.entryA)).filter(v => v !== null);
      const rp = r.map(x => pct(x.rescued.peak, x.rescued.entryT)).filter(v => v !== null);
      const rf = r.map(x => pct(x.rescued.fin, x.rescued.entryT)).filter(v => v !== null);
      console.log(`${name}: ${list.length} 拒票 | 形状A(下一/下下tick重评) 救回 ${r.length}（${(r.length / list.length * 100).toFixed(0)}%）| 现行T110(≥3s)可救 ${list.filter(x => x.t110Rescued).length}`);
      if (r.length) {
        console.log(`  救回延迟δ秒: 中位 ${med(ds)} 分布 [${ds.map(d => d).join(', ')}]`);
        console.log(`  翻转来源: t7N ${r.filter(x => x.rescued.flipBy === 't7N').length} / age ${r.filter(x => x.rescued.flipBy === 'age').length} / ath ${r.filter(x => x.rescued.flipBy === 'ath').length}`);
        console.log(`  入场代价%: 中位 ${med(costs)}（相对原锚价）| 救回票前向: 峰值中位 ${med(rp)} 终值中位 ${med(rf)} Σ终值(0.2B仓) ${sum(rf.map(v => v * 0.2 / 100))}`);
        console.log(`  未救回票基线(原锚): Σ终值 ${sum(nr.map(x => pct(x.baseFin, x.entryA) || 0).map(v => v * 0.2 / 100))}`);
      }
    };
    const okAll = out.filter(x => !x.err);
    console.log(`（缺 create 跳过 ${out.length - okAll.length}）`);
    report('全部', okAll);
    report('纯FP28拒', okAll.filter(x => x.pure));
    console.log(`\n纯 FP28 拒 + 形状A 救回明细：`);
    console.log('  token      时间(UTC)         v0(n/ath/age)  δ秒  翻转  入场代价%  峰值%  终值%');
    for (const x of okAll.filter(x => x.pure && x.rescued)) {
      console.log(`  ${x.token.slice(0, 10)} ${new Date(x.anchor).toISOString().slice(5, 19)} ${String(x.v0.n).padStart(2)}/${String(x.v0.ath).padStart(5)}/${String(x.v0.age).padStart(3)}   ${String(((x.rescued.t - x.anchor) / 1000).toFixed(1)).padStart(5)}  ${x.rescued.flipBy.padEnd(4)}  ${String(pct(x.rescued.entryT, x.entryA)).padStart(6)}  ${String(pct(x.rescued.peak, x.rescued.entryT)).padStart(6)} ${String(pct(x.rescued.fin, x.rescued.entryT)).padStart(6)}`);
    }
    const fs = require('fs');
    fs.writeFileSync(`/tmp/fp28-fpretry-${expId.slice(0, 8)}.json`, JSON.stringify(okAll, null, 1));
    console.log(`全量 → /tmp/fp28-fpretry-${expId.slice(0, 8)}.json`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
