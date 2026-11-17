// 快照成本 profile：本地空载、生产 meta 形状、JIT 预热后计时
const { readFileSync } = require('fs');
const { buildBuyPointSnapshot } = require('/Users/nobody1/Desktop/Codes/richer-js/src/market-analysis/buy-point-snapshot.js');
const { buildSnapshotFromRows } = require('/Users/nobody1/Desktop/Codes/richer-js/src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require('/Users/nobody1/Desktop/Codes/richer-js/src/market-analysis/cheat-state-builder.js');

const rows = JSON.parse(readFileSync('/tmp/prof-ticks.json', 'utf8')).rows;
rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index) || (a.id - b.id));
const meta = {
  address: rows[0].token_address, symbol: 'PROF', totalSupply: 1e9,
  platform: 'fourmeme', quoteToken: null, launchPriceBnb: 4496173469e-18,
  creatorAddress: null, name: 'PROF',
};

// 截三档锚
const sizes = [250, 500, 922];
// 预热（JIT）
for (let i = 0; i < 30; i++) buildBuyPointSnapshot(rows.slice(0, 250), meta, { capped: false, anchorTickCount: 250 });
for (let i = 0; i < 30; i++) buildSnapshotFromRows(rows.slice(0, 250), meta, { capped: false, anchorTickCount: 250 });

for (const n of sizes) {
  const sub = rows.slice(0, n);
  const N = 20;
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) buildBuyPointSnapshot(sub, meta, { capped: false, anchorTickCount: n });
  let t1 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const snap = buildSnapshotFromRows(sub, meta, { capped: false, anchorTickCount: n });
    buildCheatState(snap, { questionsVersion: 'D3.71' });
  }
  let t2 = process.hrtime.bigint();
  const bp = Number(t1 - t0) / N / 1e6, cd = Number(t2 - t1) / N / 1e6;
  console.log(`${n} 行: buyPoint ${bp.toFixed(1)}ms | cheat快照+state ${cd.toFixed(1)}ms`);
}
