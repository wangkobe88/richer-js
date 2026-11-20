const { dbManager } = require('../src/services/dbManager');
(async () => {
  const c = dbManager.getClient();
  const { data: lib, error } = await c
    .from('strategy_library')
    .select('id,name,side,version,legs')
    .eq('name', 'peak-protect-exit')
    .single();
  if (error) throw error;
  const leg = lib.legs[0];
  const note = ' | T185（2026-11-18 bt-v153 0x89aa…7777 案用户裁定「这个卖出腿需要加 debounce」）：bypass 立即路径退役→bypassDebounce=false 走 3.5s+5tick 双门确认窗（fire 重评仍真才卖、窗口内 dd 回升过 -35 → clear 不卖）；案形=峰 +118% 后 4s 闪砸 -44% bypass 卖在半山腰 +20%，18.5s 后 V 反 +211%（默认窗防不住 20s 级 V 反=用户知情选择，只防秒级插针）；深跌后低位回涨形状由 T157 因子卖出过滤门新臂 recoveryHold 接棒（debounce 确认后 peakProfitPct>=80 ∧ curVs<=40 ∧ chg5Pct>0=买入策略要买的点位→拒绝卖出，v2 库条目+实验级 factorSellFilter 配置双件）';
  const legs = [...lib.legs];
  legs[0] = { ...leg, bypassDebounce: false, description: leg.description + note };
  const { data: upd, error: upErr } = await c
    .from('strategy_library')
    .update({ legs, version: lib.version + 1 })
    .eq('id', lib.id)
    .eq('version', lib.version)
    .select('id,name,version')
    .single();
  if (upErr) throw upErr;
  console.log('updated:', upd.name, 'v' + upd.version);
  console.log('bypassDebounce:', legs[0].bypassDebounce);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
