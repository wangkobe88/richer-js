// 一次性对拍（182 跑）：BP67/题集 BP54 burst 输入桶——cheat 门 burst 判定透传
// BP activity_level 第五档。v100 ba5e 07:52 案（cheat sbw 豁免放行 vs BP act low 拒
// 叙事矛盾——用户裁定「不要重复检测，把 burst 信息输入到买入检查模块，活跃度
// 给新增一个选项：burst，这个选项不 block 买入」）。
// 矩阵：
//   立法票：ba5e 07:52:17/07:52:36/08:04:16 三行（生产 act=low(0.9/0.92/0.87)
//     activity_gate 拒）注入 cheatBurst（从该行自身 metadata.cheatCheck levels.sbw=1
//     +anchors 波三键组装，与 _cheatBurstForBp 同构）→ 期望 act=burst 综 neutral
//     gates_passed 放行
//   观察：ba5e 07:40:45 t0 行（生产 act=high spike entry_gate 拒——BP67 不解决
//     spike，注入后 act 或变 burst 但综仍 entry_gate 拒=攒批 B 留档）
//   对照（fail 方向）：ba5e 07:52:17 同锚不注入 → act 照常 low 综 poor
//     activity_gate 拒（行缺席=照常七要素判档宁拦不冒充）
//   回归锚：147d ③保持 / LOVE crash 拒保持 / c84a none 保持（不注入零漂移）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const BA5E = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
const REGRESSION = [
  { exp: V97, key: '147d-回归③保持', addr: '0x147d75f133130713c803d35a046da9b7c19effff', expect: '③拒 pattern_gate 保持' },
  { exp: V94, key: 'LOVE-回归crash保持', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒 entry_gate 保持' },
  { exp: V96, key: 'c84a-回归none保持', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, expect: 'none 综 neutral 放行保持' },
];
const logger = { info() {}, warn() {}, error() {} };

// 与 AbstractTradingEngine._cheatBurstForBp 同构（sbw 唯一资格键）
function burstFromCheatMeta(cc) {
  const levels = (cc && cc.levels) || null;
  const anchors = (cc && cc.anchors) || {};
  if (!levels || levels.stallBurstWave !== 1) return null;
  return {
    source: 'cheat', sbw: 1,
    maxGapSec: anchors.burstMaxGapSec ?? null,
    waveBuyBnb: anchors.burstWaveBuyBnb ?? null,
    waveWallets: anchors.burstWaveWallets ?? null,
    exitVsLaunchPct: anchors.burstExitVsLaunchPct ?? null,
  };
}

async function main() {
  const client = await dbManager.getClient();
  const addrs = [BA5E, ...REGRESSION.map((t) => t.addr)];
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V96, V97, V100]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  // ── ba5e v100 全 BUY 行表 + burst 豁免行（grade=healthy∧sbw=1）注入矩阵 ──
  const { data: ba5eSigs, error: e1 } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', V100).eq('signal_type', 'BUY')
    .eq('token_address', BA5E).order('created_at', { ascending: true }).limit(20);
  if (e1 || !ba5eSigs || !ba5eSigs.length) { console.log('ba5e 信号行拉取失败', e1); process.exit(1); }
  console.log(`== ba5e@v100 BUY 行 ${ba5eSigs.length} 行时序 ==`);
  for (const s of ba5eSigs) {
    const cc = (s.metadata && s.metadata.cheatCheck) || {};
    const bpSeg = (s.metadata && s.metadata.buyPoint) || {};
    console.log(`  ${s.created_at.slice(11, 19)} cheat=${cc.grade || '?'}(sbw=${(cc.levels && cc.levels.stallBurstWave) ?? '?'})`
      + ` BP=${bpSeg.status || '?'} 综=${bpSeg.assessment && bpSeg.assessment.bucket || '?'}(${bpSeg.assessment && bpSeg.assessment.rule || '?'})`);
  }

  const p5 = metaBy.get(BA5E) || {};
  const meta5 = { address: BA5E, symbol: p5.symbol || null, name: p5.name || null, platform: platBy.get(BA5E) || p5.platform || 'fourmeme' };

  // 注入矩阵：grade=healthy 的行（burst 豁免行——07:40:45 观察 + 3 行立法）
  for (const s of ba5eSigs) {
    const cc = (s.metadata && s.metadata.cheatCheck) || {};
    if (cc.grade !== 'healthy') continue;
    const burst = burstFromCheatMeta(cc);
    const anchorMs = Date.parse(s.created_at);
    const r = await bp.gateBuyPoint(BA5E, meta5, { experimentId: 'bp67-parity' }, { anchorMs, ...(burst ? { cheatBurst: burst } : {}) });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    const expect = s.created_at.slice(11, 19) === '07:40:45'
      ? '观察：act 或翻 burst 但综仍 entry_gate spike 拒（BP67 不解决 spike——攒批 B）'
      : '期望 act=burst 综 neutral gates_passed 放行（立法票）';
    console.log(`[注入] ${s.created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule}) act=${dim('activity_level')}`
      + ` entry=${dim('entry_shape')} pattern=${dim('market_pattern')} curVs=${an.currentVsLaunchPct ?? '?'}`
      + ` sbw=${burst ? 1 : 0} 波锚=${burst ? `${burst.maxGapSec}s/${burst.waveBuyBnb}B/${burst.waveWallets}w/exit${burst.exitVsLaunchPct}` : '无（healthy 但 sbw≠1——照常判）'}`
      + ` v=${r.questionVersion ?? '?'} || ${expect}`);
  }

  // 对照：07:52:17 同锚不注入（fail 方向——行缺席照常判）
  {
    const target = ba5eSigs.find((s) => s.created_at.slice(11, 19) === '07:52:17');
    if (target) {
      const r = await bp.gateBuyPoint(BA5E, meta5, { experimentId: 'bp67-parity' }, { anchorMs: Date.parse(target.created_at) });
      const a = r.assessment || {}, d = r.dimensions || {};
      const act = d.activity_level || {};
      console.log(`[对照·不注入] 07:52:17 → ${r.status} 综=${a.bucket}(${a.rule}) act=${act.bucket}(${act.prob != null ? Number(act.prob).toFixed(2) : '?'})`
        + ` || 期望=act 照常 low 综 poor activity_gate 拒（行缺席=照常七要素判档宁拦不冒充）`);
    } else { console.log('[对照·不注入] 07:52:17 行未找到（时序表核对）'); }
  }

  // 回归锚（不注入零漂移）
  for (const t of REGRESSION) {
    const idx = t.anchorIndex || 0;
    const { data } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(idx + 1);
    if (!data || data.length <= idx) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(data[idx].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp67-parity' }, { anchorMs });
    const a = r.assessment || {};
    console.log(`[回归] ${t.key} ${data[idx].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule}) v=${r.questionVersion ?? '?'} || ${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
