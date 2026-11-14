// 一次性对拍（182 跑）：BP73 两改（题集 BP57）——fresh gateBuyPoint persist:false。
//   F 翻案组：F1 28ad 07:15:58（v101）——快速暴跌后的反弹阶段（chg5/chg10 双 +14.3、未收复 -11.1 收复过半）
//              → 臂 B 第一步两件套照放，期望 entry_shape 翻 normal_dip（不再 crash）
//             F2 ba5e 07:40:45（v101）——②桶量维度组织性买入两口径（开盘第三笔单笔 0.3445>0.3 单笔口径在场）
//              → 期望 market_pattern 翻 none（不再 retail_pvp）
//   P 保护组：c84a（v101 三点全 crash 维持——未收复 -42~-44 深坑张着第一步不触发）+
//             f485/40a2（v94 臂 B 正例维持）+ a813（v95 臂 A 正例维持——BP73 不动臂 A）+
//             臂 B 六票（v100 维持 crash——未收复 -29.8~-39.8 全深坑张着第一步不得误放）+
//             a8e70（v95 ②桶双防线——量维度豁免只豁 (a)「从来无像样买单」臂，两钱包买完已清仓
//              离场走 (b) 大户卖出/散户承接臂仍落 ②retail_pvp）
//   RE 真保护：米/施工鸭 对倒正例 → entry_gate 不拦（BP73 不动臂 A/RE 域）
// 锚=生产带 buyPoint metadata 的 BUY 信号行；anchorAt 前缀匹配特定点位（28ad/ba5e 多锚票），
// 未命中回落最后一条 buyPoint 行并打 ⚠️ 标记。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc'; // bt-v101
const V100 = '11fc182a-b051-4665-857c-5c14e6713334'; // bt-v100
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';   // bt-v95
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';   // bt-v94
// chk: entryF=entry 翻离 crash / patternF=pattern 翻离 retail_pvp / entryCrash=entry 维持 crash /
//      patternPvp=pattern 维持 retail_pvp / re=entry_gate 不拦
const TOKENS = [
  // F 翻案组（BP73 生效证明）
  { g: 'F', chk: 'entryF',   exp: V101, anchorAt: '07:15:58', key: 'F1-28ad-反弹阶段',   addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: 'entry 翻 normal_dip（臂 B 第一步两件套：chg5 转正+未收复 -11.1 收复过半照放）' },
  { g: 'F', chk: 'patternF', exp: V101, anchorAt: '07:40:45', key: 'F2-ba5e-量维度',     addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', expect: 'pattern 翻 none（量维度：开盘第三笔单笔 0.3445>0.3 在场不落②(a)）' },
  // P 保护组（不得误翻）
  { g: 'P', chk: 'entryCrash', exp: V101, key: 'P-c84a-阴跌尾段维持', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'entry 维持 crash（未收复 -42~-44 深坑张着；用户明示阴跌尾段不修=拒是避亏）' },
  { g: 'P', chk: 'entryCrash', exp: V94, key: 'P-f485-臂B正例', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'crash 维持（-39.8 未收复）' },
  { g: 'P', chk: 'entryCrash', exp: V94, key: 'P-40a2-臂B正例', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: 'crash 维持（chg5 -20.8 接刀进行时）' },
  { g: 'P', chk: 'entryCrash', exp: V95, key: 'P-a813-臂A正例', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'crash 维持（BP73 不动臂 A：近窗买方整体缺席）' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-苹果SI',     addr: '0xc9bf4530033f6497002d228296fedb45036f7777', expect: 'crash 维持（-31.6 未收复）' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-LOVE',       addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 维持' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-赵公主',     addr: '0x258e485725b8d799b885b9f079241e2c812d7777', expect: 'crash 维持' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-币安之心',   addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', expect: 'crash 维持（-29.8 未收复）' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-蝴蝶人生路', addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', expect: 'crash 维持' },
  { g: 'P', chk: 'entryCrash', exp: V100, key: 'P-屎壳郎自拉', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 维持' },
  { g: 'P', chk: 'patternPvp', exp: V95, key: 'P-a8e70-②桶双防线', addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777', expect: 'pattern 维持 retail_pvp（量维度豁免只豁 (a)；两钱包买完清仓离场走 (b) 承接臂仍落②）' },
  // RE 真保护（BP73 不得误伤）
  { g: 'RE', chk: 're', exp: V95, key: 'RE-米-对倒',     addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: 'entry_gate 不拦' },
  { g: 'RE', chk: 're', exp: V95, key: 'RE-施工鸭-对倒', addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: 'entry_gate 不拦' },
];
const logger = { info() {}, warn() {}, error() {} };
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
const REPEAT = Number(process.env.REPEAT || 1);

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V101, V100, V95, V94]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  let hit = 0, total = 0;
  for (const t of ONLY ? TOKENS.filter((x) => ONLY.some((k) => x.key.includes(k))) : TOKENS) {
    for (let rep = 1; rep <= REPEAT; rep++) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(60);
    if (error || !sigs || !sigs.length) { console.log(`[${t.g}] ${t.key} 无信号行跳过`); continue; }
    const withBp = sigs.filter((s) => s.metadata && s.metadata.buyPoint);
    let anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    let atMark = '';
    if (t.anchorAt) {
      const m = withBp.find((s) => s.created_at.slice(11, 19) === t.anchorAt)
        || sigs.find((s) => s.created_at.slice(11, 19) === t.anchorAt);
      if (m) { anchor = m; } else { atMark = '⚠️anchorAt未命中回落末行'; }
    }
    const anchorMs = Date.parse(anchor.created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp73-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    const prodBp = anchor.metadata && anchor.metadata.buyPoint ? (anchor.metadata.buyPoint.assessment || {}).bucket : '?';
    const prodEntry = anchor.metadata && anchor.metadata.buyPoint ? ((anchor.metadata.buyPoint.dimensions || {}).entry_shape || {}).bucket : '?';
    const prodPat = anchor.metadata && anchor.metadata.buyPoint ? ((anchor.metadata.buyPoint.dimensions || {}).market_pattern || {}).bucket : '?';
    const entry = (d.entry_shape || {}).bucket, pat = (d.market_pattern || {}).bucket;
    let okExpect;
    if (t.chk === 'entryF') okExpect = entry !== 'crash';
    else if (t.chk === 'patternF') okExpect = pat !== 'retail_pvp';
    else if (t.chk === 'entryCrash') okExpect = entry === 'crash';
    else if (t.chk === 'patternPvp') okExpect = pat === 'retail_pvp';
    else okExpect = a.rule !== 'entry_gate' && entry !== 'crash';
    total++; if (okExpect) hit++;
    console.log(`[${t.g}]${REPEAT > 1 ? `#${rep}` : ''} ${t.key} 锚${anchor.created_at.slice(11, 19)}${atMark} 生产=${prodBp}/entry=${prodEntry}/pat=${prodPat}` +
      ` → 新=${r.status} 综=${a.bucket}(${a.rule}) entry=${dim('entry_shape')} pat=${dim('market_pattern')}` +
      ` chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'} 未收复=${an.recentDip5UnrecoveredPct ?? '?'} 捆绑=${an.bundledBlockBnb ?? '?'}×${an.bundledBlockWallets ?? '?'}w` +
      ` v=${r.questionVersion ?? '?'} ${okExpect ? '✅' : '⚠️'} || 期望=${t.expect}`);
    if (a.reasons && a.reasons.length) console.log(`   reasons=${JSON.stringify(a.reasons).slice(0, 240)}`);
    }
  }
  console.log(`\n达成 ${hit}/${total}`);
  const stats = bp.getStats ? bp.getStats() : {};
  console.log('stats=' + JSON.stringify(stats).slice(0, 400));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
