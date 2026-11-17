// 簇门扩展分析 v2（2026-11-15）：launchBundleClusterSize（最大单块首买簇）若扩展为
// 「首块(block0) + 随后第一个有交易的 block」合并簇，会挡住更多吗？
// 数据（全本地）：tmp-blockstudy-out.json（208 票出生段头 9 块 per-block 结构）+
//   tmp-v116v115.json（A 窗 v116/v115 归因）+ tmp-v120v119.json（B 窗 v120/v119）
// 口径注意：blockstudy w=块内买入去重钱包数（尘门 0.001，含加仓非首买语义）；
//   FA cluster=出生窗 90s 首买簇（任意最大单块，FA 自身尘门口径）。
//   近似扩展簇 sum = w0 + wNext（跨块不去重=上界）。
//   新增挡分两类：次块贡献（wNext>=1 才到 3）/纯口径差（wNext=0，sum=w0>=3 只是
//   blockstudy w0 比 FA cluster 大——非扩展语义功劳，是数据口径噪声）。
const fs = require('fs');

const blockStudy = JSON.parse(fs.readFileSync(__dirname + '/tmp-blockstudy-out.json', 'utf8'));
const bs = new Map();
for (const b of blockStudy) {
    if (b.err) continue;
    bs.set(b.token, b);
}
const winA = JSON.parse(fs.readFileSync(__dirname + '/tmp-v116v115.json', 'utf8'));
const winB = JSON.parse(fs.readFileSync(__dirname + '/tmp-v120v119.json', 'utf8'));

function extCluster(rec) {
    const blocks = rec.blocks || [];
    const b0 = blocks[0];
    const w0 = b0 ? b0.w : 0;
    let nextOff = null, wNext = 0;
    for (let i = 1; i < blocks.length; i++) {
        const b = blocks[i];
        if (b && (b.buyN > 0 || b.sellBnb > 0)) { nextOff = b.o; wNext = b.w; break; }
    }
    return { w0, nextOff, wNext, sum: w0 + wNext };
}

function analyze(name, legs) {
    const rows = [];
    const noBs = [];
    for (const t of legs) {
        const rec = bs.get(t.token);
        if (!rec) { noBs.push(t.symbol || t.token); continue; }
        if (rec.truncated) continue;
        const e = extCluster(rec);
        const cluster = t.cluster;
        const age = t.ageAtFire;
        const curBlocked = cluster >= 3 && age <= 60;
        const newBlocked = !curBlocked && e.sum >= 3 && age <= 60;
        rows.push({
            tok: t.token, sym: t.symbol, net: t.net, cluster, age: +age.toFixed(1),
            ...e, curBlocked, newBlocked, orgBlocks: rec.orgBlocks,
        });
    }
    const curSet = rows.filter(r => r.curBlocked);
    const newSet = rows.filter(r => r.newBlocked);
    const newTrue = newSet.filter(r => r.wNext >= 1);   // 次块真贡献
    const newNoise = newSet.filter(r => r.wNext === 0); // 纯 blockstudy/FA 口径差
    const sum = a => a.reduce((s, r) => s + (r.net || 0), 0);
    console.log(`\n===== ${name} =====`);
    console.log(`成交票（匹配非截断）${rows.length}；blockstudy 无数据 ${noBs.length}${noBs.length ? ': ' + noBs.join(',') : ''}`);
    console.log(`现门挡(cluster>=3 ∧ age<=60): ${curSet.length} 票 净 ${sum(curSet).toFixed(4)}`);
    console.log(`\n扩展口径新增挡（w0+wNext>=3 ∧ age<=60 ∧ 现门不挡）: ${newSet.length} 票 净 ${sum(newSet).toFixed(4)}`);
    console.log(`  其中次块真贡献（wNext>=1）: ${newTrue.length} 票 净 ${sum(newTrue).toFixed(4)}`);
    for (const r of newTrue.sort((a, b) => a.net - b.net)) {
        console.log(`    [次块贡献] ${r.sym} net=${r.net.toFixed(4)} cluster=${r.cluster} w0=${r.w0} +${r.nextOff}块w=${r.wNext} sum=${r.sum} age=${r.age}`);
    }
    console.log(`  其中纯口径差（wNext=0，sum=w0，非扩展语义功劳）: ${newNoise.length} 票 净 ${sum(newNoise).toFixed(4)}`);
    for (const r of newNoise.sort((a, b) => a.net - b.net)) {
        console.log(`    [口径差] ${r.sym} net=${r.net.toFixed(4)} cluster=${r.cluster} w0=${r.w0} age=${r.age}`);
    }
    const esc = curSet.filter(r => r.w0 + r.wNext < 3);
    console.log(`\n若纯替换（只看首两块、丢弃任意最大单块）会放走现门挡票: ${esc.length} 票 净 ${sum(esc).toFixed(4)}`);
    for (const r of esc.sort((a, b) => a.net - b.net)) {
        console.log(`    [替换放走] ${r.sym} net=${r.net.toFixed(4)} cluster=${r.cluster} w0=${r.w0} +${r.nextOff}块w=${r.wNext} age=${r.age} orgBlocks=${JSON.stringify(r.orgBlocks)}`);
    }
    return rows;
}

const rowsA = analyze('A 窗（bt-v115 成交）', winA.v115);
const rowsB = analyze('B 窗（bt-v119 成交）', winB.v119);

for (const [name, rows] of [['A', rowsA], ['B', rowsB]]) {
    const n = rows.filter(r => r.newBlocked && r.wNext >= 1);
    const neg = n.filter(r => r.net < 0), pos = n.filter(r => r.net >= 0);
    const s = a => a.reduce((x, r) => x + r.net, 0);
    console.log(`\n[${name} 窗·次块真贡献面] ${n.length} 票：止血 ${neg.length} 张 +${(-s(neg)).toFixed(4)} / 误伤 ${pos.length} 张 -${s(pos).toFixed(4)} → 净 ${s(n).toFixed(4)}`);
}
