// 一次性（182 跑）：R3 收尾——P7 成交信号 BP dimensions + 卖腿触发定性 + bt-v100 卖腿/止损配置
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const ADDR = '0xc9bf4530033f6497002d228296fedb45036f7777';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const ts = (s) => String(s || '').slice(11, 19);

(async () => {
  const c = await dbManager.getClient();
  // ① P7 executed 信号完整 metadata（BP dimensions + act 答案 + cheat levels）
  const { data: sigs } = await c.from('strategy_signals').select('id,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('token_address', ADDR).eq('metadata->>execution_status', 'executed');
  console.log(`executed 信号 ${sigs ? sigs.length : 0} 行`);
  for (const s of sigs || []) {
    const m = parse(s.metadata);
    const bp = m.buyPoint || {};
    console.log(`#${s.id} ${ts(s.created_at)} ${(m.strategyName || '')}`);
    console.log(`  dimensions: ${JSON.stringify(bp.dimensions || {})}`);
    console.log(`  assessment: ${JSON.stringify(bp.assessment || {})}`);
    console.log(`  anchors.curVsLaunchPct=${(bp.anchors || {}).curVsLaunchPct} chg5=${(bp.anchors || {}).chg5Pct} chg10=${(bp.anchors || {}).chg10Pct} chg30=${(bp.anchors || {}).chg30Pct} curVsAthPct=${(bp.anchors || {}).curVsAthPct}`);
    const cc = m.cheatCheck || {};
    console.log(`  cheat levels.act=${(cc.levels || {}).activityLevel} anchors.act=${(cc.anchors || {}).activityLevel}`);
  }
  // ② bt-v100 卖腿+止损+stallClose 配置
  const { data: exp } = await c.from('experiments').select('config').eq('id', EXP).limit(1);
  const cfg = parse((exp || [])[0]?.config);
  const legs = (((cfg || {}).strategiesConfig || {}).strategies || []);
  const sellLegs = legs.filter((l) => /sell/i.test(l.side || ''));
  console.log(`\n卖腿 ${sellLegs.length} 条：`);
  for (const l of sellLegs) console.log(`  ${l.name} cond=${String(l.condition).slice(0, 120)} cards=${l.cards} bypass=${l.bypassDebounce}`);
  console.log(`stopLoss=${JSON.stringify(cfg.stopLoss || null)}`);
  console.log(`stallClose=${JSON.stringify(cfg.stallClose || null)}`);
  console.log(`positionManagement=${JSON.stringify(cfg.positionManagement || null)}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
