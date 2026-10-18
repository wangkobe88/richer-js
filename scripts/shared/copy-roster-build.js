'use strict';
/**
 * 跟单簇名单判据纯函数（scan-copy-trade-clusters.cjs 与单测共享；2026-10-18 抽出）。
 *
 * 2026-10-18 0x8e0f6784 镜像对案：memberNeedsLeader 只救「挂靠著名钱包的跟班」，
 * 双开镜像对（0x8e0f6784↔0x77ae5eac 同分钟注资、co=1101 全等额、96.6% 同步清仓、
 * 永同块）没有 leader 直连边（与名单 #1 leader 0xa440 的边 co=48<50），整角落榜。
 * 组件级「孤立强指纹簇」判据在真实数据上不成立——TARGET 所在连通分量 356 钱包、
 * 含 7 个 leader、142 个现名单成员（0xaaeb 桥进大盘子，实测定案）。终版语义=
 * **边级救援**：极强指纹边（co>=extremeCo 且 even/co>=extremeRatio 或
 * sellSync/co>=extremeRatio——镜像对特征=几乎每次都等额/同步清仓）两端直接
 * 收编；rescueHops>=1 时连两端的一跳合格边邻居（簇卫星）一起收编。
 *
 * 抽出动机（红线 13）：救援臂是判据机制改动，须配零 DB 零网络单测
 * （_test_copy_roster_orphan_rescue.cjs）锁定真值表；IIFE 扫描脚本无法 require，
 * 判据逻辑沉到本共享模块。
 */

/**
 * @param {Map<string,{co:number,sellSync:number,even:number,laterA:number,laterB:number}>} pairs
 *   pair 键 'w1|w2'（字典序）；laterA=w1 后买的 token 数、laterB=w2 后买（同块不计）。
 * @param {object} opts
 *   coThr/sellSyncThr/evenThr：合格边门（co 下限 + 强度指纹任一达标，0=关该指纹）。
 *   minFollowers：leader 档邻居数下限。memberNeedsLeader：member 须挂靠 leader。
 *   orphanRescue：极强指纹边救援臂（默认 true，保留旧参名=CLI/名单 params 兼容）。
 *   extremeCo/extremeRatio：极强指纹边阈值（默认 200 / 0.8）。
 *   rescueHops：救援扩散跳数（0=只收边两端；1=连一跳合格边邻居，默认）。
 * @returns {{wallets:Array,edges:Map,rescued:Set}} wallets 项与名单文件 schema 同形
 *   （救援臂收编的带 rescued:true 标记）；rescued=被救援钱包地址 Set（报告用）。
 */
function buildRoster(pairs, {
  coThr, sellSyncThr, evenThr, minFollowers, memberNeedsLeader,
  orphanRescue = true, extremeCo = 200, extremeRatio = 0.8, rescueHops = 1,
} = {}) {
  // ── 合格边 → 邻接表（保留 per-neighbor pair 统计：救援臂的极强指纹判定要读原值）──
  const edges = new Map();   // wallet → Map<neighbor, {st, myLater}>
  const passEdge = (st) => {
    if (st.co < coThr) return false;
    if (sellSyncThr > 0 && evenThr > 0) return !(st.sellSync < sellSyncThr && st.even < evenThr);
    if (sellSyncThr > 0) return st.sellSync >= sellSyncThr;
    if (evenThr > 0) return st.even >= evenThr;
    return true;
  };
  for (const [k, st] of pairs) {
    if (!passEdge(st)) continue;
    const [w1, w2] = k.split('|');
    for (const [me, myLater, other] of [[w1, st.laterA, w2], [w2, st.laterB, w1]]) {
      let e = edges.get(me);
      if (!e) { e = new Map(); edges.set(me, e); }
      e.set(other, { st, myLater });
    }
  }

  const leaders = new Set();
  if (memberNeedsLeader) for (const [w, e] of edges) if (e.size >= minFollowers) leaders.add(w);

  // ── 极强指纹边救援臂：边两端直接收编；rescueHops>=1 连一跳合格边邻居。
  //    仅在有挂靠门时运行（memberNeedsLeader=false=无门全员进，救援无意义，
  //    输出保持与旧实现 bit 一致）──
  const rescued = new Set();
  if (orphanRescue && memberNeedsLeader) {
    const isExtreme = (st) => st.co >= extremeCo
      && (st.even >= st.co * extremeRatio || st.sellSync >= st.co * extremeRatio);
    for (const [w, e] of edges) {
      for (const { st } of e.values()) {
        if (!isExtreme(st)) continue;
        rescued.add(w);
        if (rescueHops >= 1) for (const n of e.keys()) rescued.add(n);
        break;   // 该钱包已有任一极强边即成立，无需继续扫
      }
    }
  }

  const wallets = [];
  for (const [w, e] of edges) {
    const isLeader = e.size >= minFollowers;
    if (memberNeedsLeader && !isLeader) {
      let linked = false;
      for (const n of e.keys()) if (leaders.has(n)) { linked = true; break; }
      if (!linked && !rescued.has(w)) continue;   // 挂靠门与救援臂双不过才剪
    }
    let coMax = 0, sellSyncSum = 0, evenSum = 0, laterSum = 0;
    for (const { st, myLater } of e.values()) {
      coMax = Math.max(coMax, st.co);
      sellSyncSum += st.sellSync;
      evenSum += st.even;
      laterSum += myLater;
    }
    wallets.push({
      address: w,
      role: isLeader ? 'leader' : 'member',
      followers: e.size,
      coTokens: coMax,
      syncedSells: sellSyncSum,
      evenBuys: evenSum,
      laterBuys: laterSum,
      ...(rescued.has(w) && !isLeader ? { rescued: true } : {}),
    });
  }
  wallets.sort((a, b) => b.followers - a.followers || b.coTokens - a.coTokens);
  return { edges, wallets, rescued };
}

module.exports = { buildRoster };
