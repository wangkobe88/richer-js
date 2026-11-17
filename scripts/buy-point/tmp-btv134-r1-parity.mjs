// R1 三方对拍：旧重析（BP68+旧 roster）vs 新重判（BP69+v7）vs FP3 实判 → /tmp/r1-parity.json
// 用法：node tmp-btv134-r1-parity.mjs <新run.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEW = process.argv[2];
const OLD = resolve(HERE, 'data/bp-run-2026-11-15T23-36-06-364Z.json');
const FP3 = resolve(HERE, 'data/btv134-fp3-replay.json');

const oldRun = JSON.parse(readFileSync(OLD, 'utf8'));
const newRun = JSON.parse(readFileSync(NEW, 'utf8'));
const fp3 = JSON.parse(readFileSync(FP3, 'utf8'));
const byOld = new Map(oldRun.results.map(r => [r.pointId, r]));
const byNew = new Map(newRun.results.map(r => [r.pointId, r]));
const byFp3 = new Map(fp3.map(r => [r.pointId, r]));

const out = [];
for (const [pid, n] of byNew) {
    const o = byOld.get(pid);
    const f = byFp3.get(pid);
    out.push({
        pointId: pid,
        symbol: n.tokenSymbol,
        oldMp: o?.dimensions?.market_pattern?.bucket ?? null, oldMpProb: o?.dimensions?.market_pattern?.prob ?? null,
        oldEntry: o?.dimensions?.entry_shape?.bucket ?? null,
        newMp: n.dimensions?.market_pattern?.bucket ?? null, newMpProb: n.dimensions?.market_pattern?.prob ?? null,
        newEntry: n.dimensions?.entry_shape?.bucket ?? null,
        oldBucket: o?.assessment?.bucket ?? null, newBucket: n.assessment?.bucket ?? null,
        fp3: f?.reason ?? null, fp3Branch: f?.branch ?? null,
    });
}
writeFileSync('/tmp/r1-parity.json', JSON.stringify(out, null, 1));
console.log(`parity rows=${out.length} → /tmp/r1-parity.json（scp 回本地）`);
