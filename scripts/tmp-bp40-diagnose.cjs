// BP40 立项诊断：用户 6 票裁定的当前门链判定与锚数据（bt-v79）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '1b1f9ee3-0e9a-4fda-82de-121e968be45b';
const CASES = {
  '0xcb70708ebe85cd4de4735776feef20d9c3654444': '①剧烈对倒盘(拉砸往复)',
  '0x94ea754b80bbafd776accf85d0df7f92dd73ffff': '②sustained_climb(参考slow_grind_pump)',
  '0xb788e63b15c2dfa508bb9c52b34d287d07f47777': '③应early_sniper_decay-a',
  '0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777': '③应early_sniper_decay-b',
  '0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff': '③应early_sniper_decay-c',
  '0x06810806709ae1082214624d447669e9014a7777': '④同区块对倒刷量',
};

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  for (const [addr, label] of Object.entries(CASES)) {
    const { data, error } = await db.from('strategy_signals')
      .select('token_symbol,executed,reason,created_at,metadata')
      .eq('experiment_id', EXP).eq('token_address', addr)
      .eq('signal_type', 'BUY').order('created_at');
    if (error) throw new Error(error.message);
    console.log(`\n===== ${label} ${addr} =====`);
    if (!data.length) { console.log('  无 BUY 信号'); continue; }
    console.log(`  BUY 信号 ${data.length} 条，executed=${data.filter(r => r.executed).length}`);
    for (const r of data.slice(0, 3)) {
      const m = r.metadata || {};
      const cc = m.cheatCheck || {};
      const bp = m.buyPoint || {};
      const asm = bp.assessment || {};
      console.log(`  [${r.created_at.slice(11, 19)}] exec=${r.executed} ${cc.exempt ? '豁免(' + cc.exempt.code + '←' + cc.exempt.originalGrade + ')' : 'grade=' + (cc.grade || '?')} | BP=${bp.status || '?'}${asm.bucket ? ':' + asm.bucket + '/' + asm.rule + '(' + asm.prob + ')' : ''}`);
      if (cc.reasons && cc.reasons.length) console.log('    cheat通道: ' + cc.reasons.join(' '));
      const lv = cc.levels || {};
      const lvStr = Object.entries(lv).filter(([, v]) => v && v !== 'none').map(([k, v]) => k + '=' + v).join(' ');
      if (lvStr) console.log('    cheat档位: ' + lvStr);
      // 盘型/质量题答案
      const dims = bp.dimensions || {};
      if (dims.market_pattern) console.log('    盘型=' + JSON.stringify(dims.market_pattern));
      const qs = bp.qualities || {};
      for (const [k, v] of Object.entries(qs)) {
        if (v && typeof v === 'object' && (v.bucket || v.answer)) console.log(`    质量[${k}]=${v.bucket || v.answer}`);
      }
      // 关键锚（买点 metadata 内 buyPoint 的锚——先 dump 键形状一次）
      const anchorKeys = Object.keys(bp).filter(k => !['status', 'assessment', 'dimensions', 'qualities'].includes(k));
      if (anchorKeys.length) console.log('    bp其它键: ' + anchorKeys.join(','));
      const anch = bp.anchors || bp.anchor || null;
      if (anch && typeof anch === 'object') {
        const pick = {};
        for (const k of ['athVsLaunchPct', 'maxChg5Pct', 'currentVsLaunchPct', 'openSegBuyBnb', 'openSegBuyPct', 'openSegBigTx', 'swingHighCount', 'swingLowCount', 'swingMaxAmplPct', 'pulseBlockCount', 'pulseBlockBuyPct', 'exactEqualBlockBuyPct', 'exactEqualBlockClusterCount', 'sameBlockHoldPct', 'washPairCount', 'washPairSellPct', 'pumpStablePoints', 'pumpStableSpanSec', 'pumpStableR2', 'pumpStableSlopePctPerMin', 'pumpRisePerBuyBnb', 'pumpSellTickCountPct', 'nearTail5BuyBnb', 'postStallBuyBnb']) {
          if (anch[k] !== undefined) pick[k] = anch[k];
        }
        console.log('    锚: ' + JSON.stringify(pick));
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
