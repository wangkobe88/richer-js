#!/usr/bin/env node
// FP16 上线对照：bt-v147 全部 executed BUY 信号回放 FP16（误伤面扫描）
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check');

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';

async function main() {
  const sb = dbManager.getClient();
  const { data: sigs, error } = await sb.from('strategy_signals')
    .select('token_address,created_at')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('executed', true)
    .order('created_at', { ascending: true }).limit(300);
  if (error) throw new Error(error.message);
  console.log(`bt-v147 executed BUY=${sigs.length} 条`);
  const PLAT = {};
  let hit = 0, pass = 0, errs = 0;
  for (const s of sigs) {
    const tok = s.token_address;
    try {
      const { data: rows } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
        .eq('token_address', tok).lte('block_time', s.created_at)
        .order('block_time', { ascending: false }).limit(3000);
      const ordered = [...(rows || [])].reverse();
      if (!ordered.length) { console.log(`  [skip] ${tok.slice(0, 10)}… 无锚窗行`); continue; }
      const platform = PLAT[tok] || (PLAT[tok] = ordered.some((r) => r.quote_token) ? 'flap' : 'fourmeme');
      const meta = { platform, totalSupply: 1e9, createdAt: ordered[0].block_time, creatorAddress: null };
      const snap = buildBuyPointSnapshot(ordered, meta, { capped: ordered.length >= 3000, anchorTickCount: ordered.length, signalInfo: null });
      const v = evaluateFactorPreBuy(snap);
      const bd = snap.buyDerived || {}, cd = snap.cheatDerived || {};
      if (v.reason === 'lifecycle_burst_residual') {
        hit++;
        console.log(`  🚫 ${tok.slice(0, 10)}… [${s.created_at}] ath=${bd.athVsLaunchPct}% 总=${bd.totalVolumeBnb}B minVsFloor=${bd.launchMinVsFloorPct}% 静默=${cd.burstLastGapSec}s 波买=${cd.burstWaveSegBuyBnb}B`);
      } else {
        pass++;
        // 观察：接近触发面的票（双生命周期腿过但 burst 腿或缺或豁免）
        if (bd.athVsLaunchPct >= 100 && bd.totalVolumeBnb >= 15) {
          console.log(`  ○ ${tok.slice(0, 10)}… [${s.created_at}] 大周期在窗(ath=${bd.athVsLaunchPct}% 总=${bd.totalVolumeBnb}B) 但未拦：minVsFloor=${bd.launchMinVsFloorPct}% 静默=${cd.burstLastGapSec}s sinceEnd=${cd.burstSecSinceWaveEnd}s 波买=${cd.burstWaveSegBuyBnb}B → ${v.reason || 'pass'}`);
        }
      }
    } catch (e) { errs++; console.log(`  [err] ${tok.slice(0, 10)}… ${e.message}`); }
  }
  console.log(`\n合计: FP16 拦=${hit} 放行=${pass} err=${errs}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
