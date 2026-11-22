#!/usr/bin/env node
// 一次性：扫近期实验 entry_shape=malicious_dump 的 BUY 信号（拉 metadata 本地过滤）
// 重查询：182 跑全量（本地仅单实验验证）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXPS = process.argv[2] ? process.argv[2].split(',') : ['9e9163de-a677-4d39-9c33-9ec9df05e400'];

(async () => {
  const db = dbManager.getClient();
  const out = [];
  for (const exp of EXPS) {
    let offset = 0;
    for (;;) {
      const page = await db.from('strategy_signals')
        .select('id, token_address, token_symbol, created_at, executed, metadata')
        .eq('experiment_id', exp)
        .eq('signal_type', 'BUY')
        .order('created_at', { ascending: true })
        .range(offset, offset + 999);
      if (page.error) throw new Error(`${exp}: ${page.error.message}`);
      for (const r of page.data) {
        const bp = r.metadata?.buyPoint;
        if (!bp || bp.dimensions?.entry_shape?.bucket !== 'malicious_dump') continue;
        const a = bp.anchors || {};
        out.push({
          exp: exp.slice(0, 8), token: r.token_address, sym: r.token_symbol,
          at: r.created_at, executed: r.executed,
          esProb: bp.dimensions.entry_shape.prob,
          bucket: bp.assessment?.bucket, rule: bp.assessment?.rule,
          dumpBnb: a.dumpBlockBnb, dumpDrop: a.dumpBlockDropPct, dumpSellers: a.dumpBlockSellers,
          dumpSec: a.dumpBlockSecToAnchor, dumpFbRatio: a.dumpBlockFollowBuyRatio, dumpFbBnb: a.dumpBlockFollowBuyBnb,
          d2Bnb: a.dump2BlockBnb, d2Drop: a.dump2BlockDropPct, d2Sellers: a.dump2BlockSellers,
          d2Sec: a.dump2BlockSecToAnchor, d2FbRatio: a.dump2BlockFollowBuyRatio, d2FbBnb: a.dump2BlockFollowBuyBnb,
          age: a.tokenAgeSec, curVsAth: a.currentVsAthPct, secSinceAth: a.secSinceAth,
          curVsL: a.currentVsLaunchPct, chg5: a.chg5Pct, chg30: a.chg30Pct,
          idlePct: a.actIdlePct, totalVol: a.totalVolumeBnb, maxDn5: a.maxDn5Pct,
        });
      }
      if (page.data.length < 1000) break;
      offset += 1000;
    }
  }
  console.log(`malicious_dump 信号共 ${out.length} 条`);
  for (const r of out) {
    console.log(`\n${r.token} (${r.sym}) exp=${r.exp} at=${r.at?.slice(5, 16)} prob=${r.esProb} verdict=${r.bucket}/${r.rule} exec=${r.executed}`);
    console.log(`  dump1: bnb=${r.dumpBnb} drop=${r.dumpDrop}% sellers=${r.dumpSellers} secToAnchor=${r.dumpSec} fbRatio=${r.dumpFbRatio} fbBnb=${r.dumpFbBnb}`);
    console.log(`  dump2: bnb=${r.d2Bnb} drop=${r.d2Drop}% sellers=${r.d2Sellers} secToAnchor=${r.d2Sec} fbRatio=${r.d2FbRatio} fbBnb=${r.d2FbBnb}`);
    console.log(`  age=${r.age}s curVsAth=${r.curVsAth}% secSinceAth=${r.secSinceAth}s curVsL=${r.curVsL}% chg5=${r.chg5} chg30=${r.chg30} idle=${r.idlePct}% vol=${r.totalVol} maxDn5=${r.maxDn5}`);
  }
  require('fs').writeFileSync('/tmp/mdump-scan.json', JSON.stringify(out, null, 1));
  console.log('\nwritten /tmp/mdump-scan.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
