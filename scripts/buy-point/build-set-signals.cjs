#!/usr/bin/env node
// BP set 信号触发点标记文件生成（182 跑）：sets/<set>-signals.json
// 遍历 set 全部 token，拉基底实验 BUY 信号行（含被拒），逐信号对 ticks 文件
// （链上真序全量行）标 ticks 序号/触发价/前向效果——token-ticks 页 ?bp= 叠画用。
// 口径：触发 tick=block_time<=created_at 最后一行（ticks 文件全量行序，含 outlier=复审卡表格同口径）；
// 触发价=该行或往前最近可靠价；前向=+60/+300/+900s 窗内可靠价峰/末（相对触发价）。
// fail-loud：信号行数超 limit 直接退出非零，绝不静默截断。
const fs = require('fs');
const path = require('path');

const SETS_DIR = path.join(__dirname, 'sets');
const args = process.argv.slice(2);
const setName = (args[args.indexOf('--set') + 1] || '');
if (!setName) { console.error('用法: node scripts/buy-point/build-set-signals.cjs --set <name>'); process.exit(1); }

const LIMIT = 4000;

function legShort(legId) {
  const m = /^buy_\d+_(\d+)$/.exec(String(legId || ''));
  return m ? 't' + m[1] : (legId || null);
}

function fwdOf(rows, tsFn, idx, sc, px) {
  const out = {};
  for (const w of [60, 300, 900]) {
    let mx = null, last = null;
    for (let i = idx + 1; i < rows.length; i++) {
      if (tsFn(rows[i].block_time) > sc + w * 1000) continue;
      const p = rows[i].price_bnb && !rows[i].price_outlier ? rows[i].price_bnb : null;
      if (p === null) continue;
      if (mx === null || p > mx) mx = p;
      last = p;
    }
    const pct = (p) => (p === null || !px) ? null : Math.round((p / px - 1) * 1000) / 10;
    out[String(w)] = { mx: pct(mx), last: pct(last) };
  }
  return out;
}

(async () => {
  const { dbManager } = require(path.join(__dirname, '..', '..', 'src', 'services', 'dbManager.js'));
  const c = await dbManager.getClient();

  const setFile = path.join(SETS_DIR, setName + '.json');
  const doc = JSON.parse(fs.readFileSync(setFile, 'utf8'));
  const points = doc.points || [];
  const expIds = [...new Set(points.map((p) => p.experimentId).filter(Boolean))];
  const tokens = [...new Set(points.map((p) => String(p.tokenAddress || '').toLowerCase()))];
  console.log('set:', setName, '| points:', points.length, '| tokens:', tokens.length, '| exps:', expIds.join(','));

  // 全实验 BUY 信号拉全（一次/实验；大表坑=experiment_id eq 必带，token 内存过滤）
  // ⚠PostgREST max-rows=1000 钳制：必须 range 分页循环拉全，单次 limit(4000) 实拿 1000 行静默截断
  const byToken = new Map();
  const PAGE = 1000;
  for (const expId of expIds) {
    const head = await c.from('strategy_signals')
      .select('id', { count: 'exact' })
      .eq('experiment_id', expId)
      .eq('signal_type', 'BUY')
      .limit(1);
    if (head.error) throw new Error('strategy_signals 计数失败: ' + head.error.message);
    const total = head.count || 0;
    if (total > LIMIT) { console.error(`信号行 ${total} > 上限 ${LIMIT}，防失控——放宽 LIMIT 再跑`); process.exit(1); }
    let got = 0;
    for (let off = 0; off < total || off === 0; off += PAGE) {
      const { data, error } = await c.from('strategy_signals')
        .select('id,created_at,signal_type,token_address,metadata')
        .eq('experiment_id', expId)
        .eq('signal_type', 'BUY')
        .order('id', { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) throw new Error('strategy_signals 查询失败: ' + error.message);
      for (const r of data || []) {
        const k = String(r.token_address || '').toLowerCase();
        if (!byToken.has(k)) byToken.set(k, []);
        byToken.get(k).push(r);
      }
      got += (data || []).length;
      if (!data || data.length < PAGE) break;
    }
    console.log('exp', expId.slice(0, 8), 'BUY 信号行:', got, '/', total);
  }

  const ts = (x) => new Date(x).getTime();
  const marks = {};
  let totalMarks = 0;
  for (const token of tokens) {
    const sigs = byToken.get(token) || [];
    const ticksFile = path.join(SETS_DIR, setName + '-ticks', token + '.json');
    if (!sigs.length || !fs.existsSync(ticksFile)) { if (sigs.length) console.log('warn: ticks 文件缺', token, '信号', sigs.length, '条跳过'); continue; }
    const rows = (JSON.parse(fs.readFileSync(ticksFile, 'utf8')).rows) || [];
    let base = null;
    for (const r of rows) { if (r.price_bnb && !r.price_outlier) { base = r.price_bnb; break; } }
    const arr = [];
    for (const s of sigs.sort((a, b) => ts(a.created_at) - ts(b.created_at))) {
      const m = s.metadata || {};
      const sc = ts(s.created_at);
      let idx = -1;
      for (let i = 0; i < rows.length; i++) { if (ts(rows[i].block_time) <= sc) idx = i; }
      if (idx < 0) continue;
      let px = null;
      for (let i = idx; i >= 0; i--) { if (rows[i].price_bnb && !rows[i].price_outlier) { px = rows[i].price_bnb; break; } }
      const sg = m.signalGate || {};
      arr.push({
        at: s.created_at,
        legId: sg.legId || null,
        leg: legShort(sg.legId),
        triggerNo: sg.triggerNo ?? null,
        tickNo: idx + 1,
        totalTicks: rows.length,
        priceBnb: px,
        vsFirstPct: (px && base) ? Math.round((px / base - 1) * 1000) / 10 : null,
        exec: m.execution_status || null,
        reason: m.execution_reason || (m.signalGate && m.signalGate.reason) || null,
        fwd: fwdOf(rows, ts, idx, sc, px),
      });
    }
    if (arr.length) { marks[token] = arr; totalMarks += arr.length; }
  }

  const out = { setName, builtAt: new Date().toISOString(), generatedBy: 'build-set-signals.cjs', marks };
  const outFile = path.join(SETS_DIR, setName + '-signals.json');
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('输出:', outFile, '| tokens 带标记:', Object.keys(marks).length, '| 信号标记总数:', totalMarks);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
