// 一次性对拍（182 跑）：CD397/D3.67 burst 判定权归 Jev（sbw 题重写+G8/CD383 四腿退役=G18）
// - 19 票：14 burst 问题票（v100 族三取证 signal id）+ M4GA/ba5e（同址两锚）+ ad80 + 189/198
// - 期望（台账 CD397 对拍计划）：19/62/63/69/72/96/170/198 sbw 翻 none（跨度/尘埃/流向
//   各轴坐实→豁免失效）、191 sbw=burst 豁免恢复（exitVs 113.9 不再硬拒）、
//   M4GA/ba5e 保持 burst 豁免、123/174/179 按 Jev 判
// - 每票：fresh CheatCheckService（persist:false）真调 Jev（锚=signal created_at）+
//   同锚复算 snapshot derived 读 D3.67 单段绑定波族十键
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { buildSnapshotFromRows } = require('../../src/market-analysis/cheat-snapshot');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const ED11 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const IDX_SIGS = {
  19: ['Flap', '5c953aeb-70a6-47b3-aa52-0c3943df267d'],
  62: ['王涛二', '258ae2a7-2d42-4ae6-9352-5e37e9f1954a'],
  63: ['memeful', '49786f0b-5a4b-4a08-b216-67605584c1b4'],
  69: ['VirusSI', '3b2d3161-4f83-4dda-9e76-c7a2fa202515'],
  72: ['持械入宋', '3f858dea-15ad-4df6-82d5-70932493f11c'],
  81: ['小四', '215f9bff-2f98-4094-8da1-2860fe3b9440'],
  96: ['四', '4d8d73f9-e73e-401e-aa1a-9097284d5eb6'],
  123: ['(无地址票)', '473b37c1-9c61-4bc0-a017-60111fb00413'],
  124: ['汽茫', '18c18419-fd22-4ad1-bdaa-24175c8f370a'],
  130: ['MMGA', '1e24d257-b729-4454-9d03-5cd9eb487150'],
  170: ['M7GA', '300d26d4-98cc-4fcc-88ea-0672a39d71c8'],
  174: ['memetuk二', '14c57c46-9557-4572-a1e3-2d8a9dfcadf2'],
  179: ['Look At Coins', '25f06452-ad05-4454-afd7-8fa9a9464ff5'],
  191: ['拒向', '6ef037d6-5318-4d3e-846f-90fb08bfb160'],
};
const EXTRA = [
  { name: 'M4GA(v100锚)', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', exp: V100, hhmmss: '07:40:45' },
  { name: 'ba5e(BP67锚)', addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', exp: ED11, hhmmss: '07:52:17' },
  { name: 'ad80', addr: '0xad80fb7a03686a9a12952efa17312cf10e86ffff', exp: V100, hhmmss: null },
  { name: '189 AURVEN', addr: '0x8614876e509c18d7be305a39a4a8d9e69c5effff', exp: V100, hhmmss: null },
  { name: '198 CR', addr: '0xbcb27c14a0faec17461cb6101810aee9fb554444', exp: V100, hhmmss: null },
];
const logger = { info() {}, warn() {}, error() {} };

async function sigsByExp(exp) {
  const out = []; let cur = '';
  for (let p = 0; p < 40; p++) {
    let b = dbManager.getClient().from('strategy_signals')
      .select('id,token_address,created_at').eq('experiment_id', exp).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(1000); if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const client = await dbManager.getClient();
  // 1) idx 票按 signal id 定位
  const ids = Object.values(IDX_SIGS).map((x) => x[1]);
  const { data: byId, error: e1 } = await client.from('strategy_signals')
    .select('id,token_address,created_at,experiment_id').in('id', ids);
  if (e1) throw new Error(e1.message);
  const byIdMap = new Map((byId || []).map((r) => [r.id, r]));

  // 2) EXTRA 票按实验 signals 定位（ad80/189/198 取该票首条 BUY；miss 回落 cheat_detection）
  const sigsV100 = await sigsByExp(V100);
  const sigsEd = await sigsByExp(ED11);
  const closest = (rows, addr, hhmmss) => {
    const rr = rows.filter((s) => s.token_address === addr);
    if (!rr.length) return null;
    if (!hhmmss) return rr[0];
    return rr.reduce((a, b) => (Math.abs(Date.parse(b.created_at) - Date.parse(b.created_at.slice(0, 11) + hhmmss + b.created_at.slice(19))) <
      Math.abs(Date.parse(a.created_at) - Date.parse(a.created_at.slice(0, 11) + hhmmss + a.created_at.slice(19))) ? b : a));
  };

  const tickets = [];
  for (const [idx, [nm, sid]] of Object.entries(IDX_SIGS)) {
    const r = byIdMap.get(sid);
    if (!r) { console.log(`WARN idx${idx} signal ${sid} 未找到`); continue; }
    tickets.push({ key: `idx${idx}`, name: nm, addr: r.token_address, anchorMs: Date.parse(r.created_at), at: r.created_at });
  }
  for (const t of EXTRA) {
    let sig = closest(t.exp === V100 ? sigsV100 : sigsEd, t.addr, t.hhmmss);
    if (!sig && t.exp === V100) sig = closest(sigsEd, t.addr, t.hhmmss); // 换实验再试
    if (!sig) {
      // cheat_detection 回落：该 token 最近 observed 行 analyzed_at 做锚
      const { data: cd, error: ecd } = await client.from('cheat_detection')
        .select('analyzed_at').eq('token_address', t.addr).order('analyzed_at', { ascending: false }).limit(50);
      if (ecd) console.log(`WARN ${t.name} cheat_detection 回落失败: ${ecd.message}`);
      if (cd && cd.length) {
        const row = t.hhmmss
          ? cd.reduce((a, b) => (Math.abs(Date.parse(b.analyzed_at) - Date.parse(b.analyzed_at.slice(0, 11) + t.hhmmss + b.analyzed_at.slice(19))) <
              Math.abs(Date.parse(a.analyzed_at) - Date.parse(a.analyzed_at.slice(0, 11) + t.hhmmss + a.analyzed_at.slice(19))) ? b : a))
          : cd[0];
        tickets.push({ key: t.name, name: t.name, addr: t.addr, anchorMs: Date.parse(row.analyzed_at), at: row.analyzed_at + '(cheat行)' });
        continue;
      }
      console.log(`WARN ${t.name} ${t.addr} 无锚跳过`);
      continue;
    }
    tickets.push({ key: t.name, name: t.name, addr: t.addr, anchorMs: Date.parse(sig.created_at), at: sig.created_at });
  }

  // 3) token_create meta（platform/launch 常量源）
  const addrs = [...new Set(tickets.map((t) => t.addr))];
  const creates = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const { data: d, error } = await client.from('wss_events')
      .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 100));
    if (error) throw new Error(error.message);
    if (d) creates.push(...d);
  }
  const createByToken = new Map(creates.map((r) => [r.token_address, r]));
  const metaFor = (addr) => {
    const c = createByToken.get(addr); const p = (c && c.payload) || {};
    return { address: addr, symbol: p.symbol || null, name: p.name || null, platform: p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
  };

  const fmt = (v) => (v === null || v === undefined ? '—' : v);
  const D67 = ['burstLastGapSec', 'burstExitWaveBuyBnb', 'burstExitWaveWallets', 'burstSecSinceWaveEnd',
    'burstWaveWalletNetBnb', 'burstWaveSellBackPct', 'burstWaveWalletAvgBnb', 'burstWaveWalletMedianBnb',
    'burstExitVsLaunchPct', 'burstMaxGapSec', 'burstWaveBuyBnb', 'burstWaveWallets'];

  console.log(`共 ${tickets.length} 票`);
  for (const t of tickets) {
    // 每票 fresh service（防粘滞/inflight 串票；M4GA/ba5e 同址两锚必须隔离）
    const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
      settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
    let line = '';
    try {
      const res = await svc.gateBuyPoint(t.addr, metaFor(t.addr), { experimentId: 'cd397-parity' }, { awaitMs: 120000, anchorMs: t.anchorMs });
      const sbwNum = res && res.levels ? res.levels.stallBurstWave : undefined;
      const grade = res && res.grade ? res.grade : (res && res.status) || 'none';
      const act = res && res.buckets ? res.buckets.activityLevel : '?';
      const ex = res && res.exempt ? res.exempt.code : null;
      const dn = res && res.exemptDenied ? res.exemptDenied : null;
      line = `sbw=${sbwNum === 1 ? 'burst' : sbwNum === 0 ? 'none' : fmt(sbwNum)} grade=${grade} act=${act}` +
        (ex ? ` exempt=${ex}` : '') + (dn ? ` denied=${dn}` : '');
    } catch (e) {
      line = `门异常: ${e.message}`;
    }
    // 同锚复算 digest（读 D3.67 波族键，零 Jev）
    let dline = '';
    try {
      const svc2 = new CheatCheckService({ enabled: true, settleDelayMs: 0, memSource: { enabled: false }, persist: false }, logger, {});
      const pull = await svc2._pullTicksDb(t.addr, t.anchorMs);
      const createMeta = await svc2._loadCreateMeta(t.addr);
      const meta = svc2._normalizeMeta(t.addr, metaFor(t.addr), pull, createMeta);
      const snap = buildSnapshotFromRows(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
      const d = snap.derived;
      dline = `ticks=${pull.anchorTickCount} ` + D67.map((k) => `${k.replace(/^burst/, '').replace(/^(Exit)?Wave/, 'W')}:${fmt(d[k])}`).join(' ');
    } catch (e) {
      dline = `digest 复算异常: ${e.message}`;
    }
    console.log(`[${t.key}] ${t.name} ${t.addr.slice(0, 10)}… ${t.at} | ${line} | ${dline}`);
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
