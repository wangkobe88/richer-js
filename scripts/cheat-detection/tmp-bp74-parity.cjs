// 一次性对拍（182 跑）：BP74（题集 BP58）——c84a 黄金票案臂 B 第二步「买入力在场豁免」。
//   F 翻案组：c84a 三锚 12:31:26/32/38（v101）——深坑张着（未收复 -42~-44）但尾 10s 买力在场
//              （2.0B×12 笔 / 0.41B×5 笔 / 0.12B×4 笔贴线过）→ 期望 entry_shape 翻 normal_dip
//              （32s 锚 curVs≈+31.3 可能仍被统一门 28.5 拒=属正常，本对拍只验 entry 维度翻案）
//   P 保护组：f485（尾 10s 零买=买力不在场，近窗巨量是遗迹——BP74 分离轴正例维持拒）+
//             40a2（急跌进行时 chg5 -20.8≈chg10 BP59 轴不被第二步豁免）+
//             臂 B 四票（v100 未收复 -29.8~-39.8 深坑张着+尾段买力不在场维持 crash）+
//             a813（v95 臂 A 正例维持——BP74 不动臂 A）+
//             a8e70（v95 ②桶双防线维持）
//   PD 防回退：28ad 07:15:58（BP73 第一步反弹阶段照放不得回退）/ ba5e 07:40:45（BP73 量维度翻案不得回退）
//   RE 真保护：米/施工鸭 对倒正例 → entry_gate 不拦
// 锚=生产带 buyPoint metadata 的 BUY 信号行；anchorAt 前缀匹配特定点位，未命中回落最后一条并打 ⚠️ 标记。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc'; // bt-v101
const V100 = '11fc182a-b051-4665-857c-5c14e6713334'; // bt-v100
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';   // bt-v95
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';   // bt-v94
// chk: entryF=entry 翻离 crash / patternF=pattern 翻离 retail_pvp / entryCrash=entry 维持 crash /
//      patternPvp=pattern 维持 retail_pvp / re=entry_gate 不拦
const TOKENS = [
  // F 翻案组（BP74 生效证明——c84a 三锚全部翻 normal_dip）
  { g: 'F', chk: 'entryF', exp: V101, anchorAt: '12:31:26', key: 'F1-c84a-26s-买力在场', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'entry 翻 normal_dip（臂 B 第二步：尾 10s 买 2.0B×12 笔在场；深坑张着但买力还在照放）' },
  { g: 'F', chk: 'entryF', exp: V101, anchorAt: '12:31:32', key: 'F2-c84a-32s-买力在场', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'entry 翻 normal_dip（臂 B 第二步：尾 10s 买 0.41B×5 笔在场）' },
  { g: 'F', chk: 'entryF', exp: V101, anchorAt: '12:31:38', key: 'F3-c84a-38s-贴线',     addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'entry 翻 normal_dip（臂 B 第二步：尾 10s 买 0.12B×4 笔贴线过 ≥3 笔 ∧ ≥0.1 BNB）' },
  // P 保护组（不得误翻；anchorAt=生产 crash 判定锚，probe 定位——多锚票末行常是 normal_dip 行不可用）
  { g: 'P', chk: 'entryCrash', exp: V94, key: 'P-f485-尾10零买', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'crash 维持（BP74 分离轴：尾 10s 零买=买力不在场，近窗巨量是遗迹）' },
  { g: 'P', chk: 'entryCrash', exp: V94, key: 'P-40a2-急跌进行时', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: 'crash 维持（chg5 -20.8≈chg10 同深无铺垫=BP59 轴不被第二步豁免；方差票 BP73 攒批已录，REPEAT 判稳）' },
  { g: 'P', chk: 'entryCrash', exp: V100, anchorAt: '05:11:26', key: 'P-苹果SI',     addr: '0xc9bf4530033f6497002d228296fedb45036f7777', expect: 'crash 维持（-31.6 未收复+尾段买力不在场；生产 crash 0.62）' },
  { g: 'P', chk: 'entryCrash', exp: V100, anchorAt: '11:24:41', key: 'P-赵公主-258e', addr: '0x258e485725b8d799b885b9f079241e2c812d7777', expect: 'crash 维持（BP63 判例：暴跌回到 almost_launch 区也不豁免——位置低≠跌势已止；生产 crash 0.88）' },
  { g: 'P', chk: 'entryCrash', exp: V100, anchorAt: '12:11:23', key: 'P-币安之心',   addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', expect: 'crash 维持（-29.8 未收复+尾段买力不在场；生产 crash 0.51）' },
  { g: 'P', chk: 'entryCrash', exp: V100, anchorAt: '12:43:05', key: 'P-蝴蝶人生路', addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', expect: 'crash 维持（生产 crash 0.60；BP73 攒批已录蝴蝶 Jev 方差，⚠️ 单跑不计失败）' },
  { g: 'P', chk: 'entryCrash', exp: V100, anchorAt: '13:36:06', key: 'P-屎壳郎自拉', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 维持（生产 crash 0.74）' },
  // LOVE：V94/V100 生产无 crash 锚（V94 无 entry_shape 题、V100 唯一 bp 行=normal_dip 0.68）
  //   → 改保护 normal_dip 正例不被 BP74 误伤（放宽方向不收紧）
  { g: 'P', chk: 'entryF', exp: V100, anchorAt: '09:06:00', key: 'P-LOVE-normal正例', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: '非 crash（生产 normal_dip 0.68 维持——BP74 只放宽 crash 侧不收紧 normal_dip 侧）' },
  { g: 'P', chk: 'patternPvp', exp: V95, key: 'P-a8e70-②桶双防线', addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777', expect: 'pattern 维持 retail_pvp（量维度豁免只豁 (a)；两钱包买完清仓离场走 (b) 承接臂仍落②；生产行 pat=none 无 retail_pvp 锚=BP73 对拍时代 fresh 判定，方差票 BP73 攒批已录）' },
  // PD 追加：a813 末锚（BP73 复盘已收编「末锚反弹形状期望设错」——chg5+19.8 转正∧未收复+4.8 已收复，
  //   第一步反弹两件套命中照放是 BP73 正确执行，非 BP74 泄漏；BP72 臂 A 域在本锚不成立）
  { g: 'PD', chk: 'entryF', exp: V95, key: 'PD-a813-末锚反弹', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: '非 crash（BP73 第一步反弹阶段照放：chg5 转正+未收复收窄；生产 v95 crash 1.00 为数值四臂时代判定）' },
  // PD 防回退组（BP73 两翻案票 BP74 不得回退）
  { g: 'PD', chk: 'entryF',   exp: V101, anchorAt: '07:15:58', key: 'PD-28ad-反弹阶段',   addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: 'entry 保持 non-crash（BP73 第一步两件套照放不得回退）' },
  { g: 'PD', chk: 'patternF', exp: V101, anchorAt: '07:40:45', key: 'PD-ba5e-量维度',     addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', expect: 'pattern 保持 non-retail_pvp（BP73 量维度翻案不得回退）' },
  // RE 真保护（BP74 不得误伤）
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

  const mkSvc = () => new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});
  let bp = mkSvc();
  const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');

  let hit = 0, total = 0;
  for (const t of ONLY ? TOKENS.filter((x) => ONLY.some((k) => x.key.includes(k))) : TOKENS) {
    let t10 = ''; // 锚窗尾 10s 买力直采（确定性，rep=1 算一次全程复用）
    for (let rep = 1; rep <= REPEAT; rep++) {
    if (REPEAT > 1) bp = mkSvc(); // 每 rep 新实例绕进程内粘滞缓存，真跑 Jev
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
    if (rep === 1) { // 尾 10s 买力直采（snapshot 确定性读数，非 Jev 产物）
      try {
        const pull0 = await bp._pullTicksDb(t.addr, anchorMs);
        const act = (buildBuyPointSnapshot(pull0.rows || [], { address: t.addr, platform: 'fourmeme' }).buyDerived.activity) || {};
        const f4x = (n) => (n == null ? '?' : (+n).toFixed(4));
        t10 = ` 尾10买=${f4x(act.nearTail10BuyBnb)}×${act.nearTail10BuyN ?? '?'}笔`;
      } catch (e) { t10 = ' 尾10买=?'; }
    }
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp74-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    const prodBp = anchor.metadata && anchor.metadata.buyPoint ? (anchor.metadata.buyPoint.assessment || {}).bucket : '?';
    const prodEntry = anchor.metadata && anchor.metadata.buyPoint ? ((anchor.metadata.buyPoint.dimensions || {}).entry_shape || {}).bucket : '?';
    const entry = (d.entry_shape || {}).bucket, pat = (d.market_pattern || {}).bucket;
    let okExpect;
    if (t.chk === 'entryF') okExpect = entry !== 'crash';
    else if (t.chk === 'patternF') okExpect = pat !== 'retail_pvp';
    else if (t.chk === 'entryCrash') okExpect = entry === 'crash';
    else if (t.chk === 'patternPvp') okExpect = pat === 'retail_pvp';
    else okExpect = a.rule !== 'entry_gate' && entry !== 'crash';
    total++; if (okExpect) hit++;
    const f2 = (n) => (n == null ? '?' : (+n).toFixed(2));
    const f4 = (n) => (n == null ? '?' : (+n).toFixed(4));
    console.log(`[${t.g}]${REPEAT > 1 ? `#${rep}` : ''} ${t.key} 锚${anchor.created_at.slice(11, 19)}${atMark} 生产=${prodBp}/entry=${prodEntry}` +
      ` → 新=${r.status} 综=${a.bucket}(${a.rule}) entry=${dim('entry_shape')} pat=${dim('market_pattern')}` +
      ` chg5=${f2(an.chg5Pct)} chg10=${f2(an.chg10Pct)} 未收复=${f2(an.recentDip5UnrecoveredPct)}${t10}` +
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
