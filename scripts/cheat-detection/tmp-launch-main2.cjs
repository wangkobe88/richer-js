// 一次性（182 跑，读 /tmp/launch-research.json 不重查 DB）：launch 调研 v2 汇总——
//   修正主体脚本口径 bug：flap 全量被 quote 标记剔除（8452/8452），而族一案（T130 两案 67ad68e0/6efa11ce）恰是 flap 低开域
//   Phase A: 族一 9 票+T130 2 票逐票明细（JSON find；不在 JSON 的查 DB）
//   Phase B: flap q=1(quote)/q=0 分组 firstBuy vs FL 常量分带 × 表现（对齐 fourmeme 输出格式）
//   Phase C: flap 低开 firstBuy 值聚集分析（离散 tier 档位证据）+ minAt vs fbt 先后（方案三域=运行期新低占比）
//   Phase D: fourmeme 高开带 maxVs 表现细节（妖票温床验证：+5~+50 高开档 vs 常量域对照组）
const { dbManager } = require('../../src/services/dbManager.js');
const fs = require('fs');
const FM = 4496173469e-18;
const FL = 6.14 / (107036752 + 1e9);

const CLAN1 = [
  ['idx2 정책콕', '0x9d147fa0e447d98cf1a7ac32f114f6d0b9877777'],
  ['idx95 咪咪', '0x3d11be20f94428d34fd21c9fae24aa6cfc5cffff'],
  ['idx164 TukTuk', '0x2711e159f3e9ff438ff2bb80456d19a6bd827777'],
  ['idx165 MBF', '0xa29fefb9922a761093a316e9f658c0f0ebc07777'],
  ['idx167 memectuk', '0x9dfe83281eb66b74dd5c432395a3c14091967777'],
  ['idx182 CR', '0x4a9a469973b8bc8486a923490ecdc3cf249a7777'],
  ['idx192 팔꿈치', '0x1ff6da9856abf6d7869797f46468f5e883c57777'],
  ['idx143 我靠(fourmeme)', '0xcbfe6b2bceacfab7934c82513f568f4e31a04444'],
  ['idx180 SAMSUNG', '0x54117eb6d2481dc8d89ee377e00e683f882f7777'],
];
const T130 = [['T130a 67ad68e0', '67ad68e0'], ['T130b 6efa11ce', '6efa11ce']];

async function main() {
  const rows = JSON.parse(fs.readFileSync('/tmp/launch-research.json', 'utf8'));
  const byAddr = new Map(rows.map((r) => [r.a.toLowerCase(), r]));
  const pct = (a, b) => ((a / b) - 1) * 100;

  // ---- Phase A: 族一 9 票+T130 2 票 ----
  console.log('===== Phase A 族一 9 票+T130 2 票明细 =====');
  const targets = [...CLAN1, ...T130];
  const missing = [];
  for (const [name, addr] of targets) {
    const full = addr.startsWith('0x') ? addr.toLowerCase() : null;
    let r = full ? byAddr.get(full) : null;
    if (!r && !full) { // T130 短前缀：JSON 里前缀匹配
      for (const [k, v] of byAddr) if (k.startsWith(addr.toLowerCase())) { r = v; break; }
    }
    if (!r) { missing.push([name, addr]); continue; }
    const CONST = r.p === 'fourmeme' ? FM : FL;
    const fbVs = r.fb ? pct(r.fb, CONST) : null;
    const minVs = r.min ? pct(r.min, CONST) : null;
    const maxVsFb = r.fb && r.max ? pct(r.max, r.fb) : null;
    const lastVsFb = r.fb && r.last ? pct(r.last, r.fb) : null;
    // 方案三域：min 是否发生在首买之后（运行期新低）vs 之前/同时（开盘即低）
    let minPhase = '-';
    if (r.minAt && r.fbt) minPhase = Date.parse(r.minAt) >= Date.parse(r.fbt) ? '首买后' : '首买前';
    console.log(`${name} [${r.p}${r.q ? ',quote' : ''}] ticks=${r.n} fb=${r.fb ? r.fb.toExponential(3) : '-'}(${fbVs === null ? '-' : fbVs.toFixed(1)}% vs 常量) 首买额=${r.fbb ? r.fbb.toFixed(3) : '-'}B | min=${r.min ? r.min.toExponential(3) : '-'}(${minVs === null ? '-' : minVs.toFixed(1)}%,${minPhase}) | maxVs首买=${maxVsFb === null ? '-' : maxVsFb.toFixed(1)}% lastVs首买=${lastVsFb === null ? '-' : lastVsFb.toFixed(1)}% span=${r.spanSec === null ? '-' : Math.round(r.spanSec) + 's'}`);
  }
  if (missing.length) {
    console.log(`JSON 缺 ${missing.length} 只（时间窗外？），查 DB：`);
    const sb = await dbManager.getClient();
    for (const [name, addr] of missing) {
      const q = addr.startsWith('0x') ? sb.from('wss_events').select('platform,token_address,block_time').eq('kind', 'token_create').eq('token_address', addr) : sb.from('wss_events').select('platform,token_address,block_time').eq('kind', 'token_create').ilike('token_address', addr + '%');
      const { data } = await q.limit(2);
      console.log(`  ${name} ${addr}: ${data && data.length ? JSON.stringify(data) : 'token_create 无行（窗内无此票）'}`);
    }
  }

  // ---- Phase B: flap 分组统计 ----
  const flap = rows.filter((r) => r.p === 'flap');
  console.log(`\n===== Phase B flap 全量 ${flap.length}（q=1 quote ${flap.filter((r) => r.q).length} / q=0 BNB盘 ${flap.filter((r) => !r.q).length}）=====`);
  for (const [label, pool0] of [['quote 盘', flap.filter((r) => r.q)], ['BNB 盘', flap.filter((r) => !r.q)]]) {
    const traded = pool0.filter((r) => r.fb);
    console.log(`-- [${label}] 总 ${pool0.length} | 有首买 ${traded.length} --`);
    const bands = [['<-50%', -1e9, -50], ['-50~-20', -50, -20], ['-20~-5', -20, -5], ['-5~+5(常量域)', -5, 5], ['+5~+20', 5, 20], ['+20~+50', 20, 50], ['>+50%', 50, 1e9]];
    for (const [name, lo, hi] of bands) {
      const g = traded.filter((r) => { const d = pct(r.fb, FL); return d >= lo && d < hi; });
      if (!g.length) { console.log(`  ${name}: 0`); continue; }
      const maxVs = g.map((r) => pct(r.max, r.fb)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const lastVs = g.map((r) => pct(r.last, r.fb)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
      const p90 = (arr) => (arr.length ? arr[Math.floor(arr.length * 0.9)] : null);
      const good = maxVs.filter((v) => v >= 50).length;
      console.log(`  ${name}: ${g.length} 只 | maxVs首买 中位=${med(maxVs) === null ? '-' : med(maxVs).toFixed(1)}% P90=${p90(maxVs) === null ? '-' : p90(maxVs).toFixed(1)}% ≥+50%=${good}(${(100 * good / g.length).toFixed(0)}%) | lastVs首买 中位=${med(lastVs) === null ? '-' : med(lastVs).toFixed(1)}%`);
    }
    // 方案三域：有首买票中 min 出现在首买后且 min<常量-5% 的占比（锚下移域）
    const t2 = traded.filter((r) => r.minAt && r.fbt && Date.parse(r.minAt) > Date.parse(r.fbt) && pct(r.min, FL) < -5);
    const belowAny = pool0.filter((r) => r.min && pct(r.min, FL) < -5);
    console.log(`  全史 min<常量-5%: ${belowAny.length}(${(100 * belowAny.length / pool0.length).toFixed(1)}%) | 其中首买后新低（方案三域）: ${t2.length}(${traded.length ? (100 * t2.length / traded.length).toFixed(1) : 0}% 的有首买票)`);
  }

  // ---- Phase C: flap 低开值聚集（tier 档位证据）----
  console.log('\n===== Phase C flap 低开 firstBuy 值聚集（<-5% 票，FL 常量倍数直方）=====');
  const lows = flap.filter((r) => r.fb && pct(r.fb, FL) < -5);
  const histo = new Map();
  for (const r of lows) {
    const mult = r.fb / FL;
    // 对数分桶：0.1~0.9 → 两位有效
    const key = mult >= 0.5 ? mult.toFixed(2) : mult.toFixed(2);
    histo.set(key, (histo.get(key) || 0) + 1);
  }
  const sorted = [...histo.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [k, v] of sorted) console.log(`  ${k}×FL: ${v} 只`);
  console.log(`低开合计 ${lows.length} 只`);

  // ---- Phase D: fourmeme 高开带 vs 常量域对照 ----
  console.log('\n===== Phase D fourmeme：首买额+生命周期对照（高开档妖票温床验证）=====');
  const fm = rows.filter((r) => r.p === 'fourmeme' && r.fb);
  for (const [name, fn] of [['常量域(-5~+5%)', (d) => d >= -5 && d < 5], ['高开(+5~+50%)', (d) => d >= 5 && d < 50], ['超高开(>+50%)', (d) => d >= 50]]) {
    const g = fm.filter((r) => fn(pct(r.fb, FM)));
    if (!g.length) continue;
    const fbb = g.map((r) => r.fbb).filter((v) => v != null).sort((a, b) => a - b);
    const span = g.map((r) => r.spanSec).filter((v) => v != null).sort((a, b) => a - b);
    const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
    console.log(`  ${name}: ${g.length} 只 | 首买额中位=${med(fbb) === null ? '-' : med(fbb).toFixed(3)}B | 生命周期中位=${med(span) === null ? '-' : Math.round(med(span)) + 's'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
