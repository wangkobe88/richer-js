#!/usr/bin/env python3
# bt-v113 误伤票研究：act>=0.6 桶内 盈利11 vs 亏损37 全因子对比
import json, math

d = json.load(open('/Users/nobody1/Desktop/Codes/richer-js/tmp-fa-bt113.json'))
toks = d['tokens']

def getf(t, k):
    v = (t.get('factors') or {}).get(k)
    if v is None: return None
    try: v = float(v)
    except: return None
    if math.isnan(v) or math.isinf(v): return None
    return v

hi = [t for t in toks if (getf(t,'actTotalBnb') or 0) >= 0.6]
win = [t for t in hi if t['net'] > 0]
los = [t for t in hi if t['net'] <= 0]
print(f"act>=0.6 桶: 盈利 {len(win)} 张 (Σ{sum(t['net'] for t in win):+.4f}) | 亏损 {len(los)} 张 (Σ{sum(t['net'] for t in los):+.4f})\n")

# ---- 派生特征（热度构成）----
def derived(t):
    f = {}
    ab, asl, at = getf(t,'actBuyBnb'), getf(t,'actSellBnb'), getf(t,'actTotalBnb')
    if at and at > 0:
        f['卖出占比10s'] = (asl or 0)/at*100
        f['买入占比10s'] = (ab or 0)/at*100
    f['actNetBnb_'] = getf(t,'actNetBnb')
    return f

def getany(t, k):
    v = getf(t, k)
    if v is not None: return v
    return derived(t).get(k)

# ---- 全因子排名分离（winner rank AUC）----
factors = set()
for t in hi:
    factors |= set((t.get('factors') or {}).keys())
    factors |= set(derived(t).keys())

rows = []
for k in factors:
    pairs = []
    for t in hi:
        v = getany(t, k)
        if v is None: continue
        pairs.append((v, t['net'] > 0))
    if len(pairs) < 30: continue
    vals = len(set(round(v,4) for v,_ in pairs))
    if vals < 4: continue
    srt = sorted(pairs)
    # AUC: P(win_value > lose_value)
    w_ranks = []
    for i,(v,isw) in enumerate(srt):
        if isw: w_ranks.append(i)
    n1, n0 = sum(1 for _,w in pairs if w), sum(1 for _,w in pairs if not w)
    if n1 < 5 or n0 < 10: continue
    auc = (sum(w_ranks) - n1*(n1-1)/2) / (n1*n0)
    wmed = sorted(v for v,w in pairs if w)[n1//2]
    lmed = sorted(v for v,w in pairs if not w)[n0//2]
    rows.append((abs(auc-0.5), auc, k, wmed, lmed, n1, n0))

rows.sort(reverse=True)
print("===== 桶内分离 Top 20（AUC 离 0.5 越远越可分；中位数 盈利vs亏损）=====")
for a, auc, k, wm, lm, n1, n0 in rows[:20]:
    def f(x):
        s = f"{x:.4g}" if abs(x) < 1000 else f"{x:.0f}"
        return s
    print(f"  {k:<34} AUC={auc:+.3f}  盈利med={f(wm):>12}  亏损med={f(lm):>12}")

# ---- 用户理论方向：筹码/庄维度逐项 ----
print("\n===== 筹码/庄维度明细（盈利票 vs 亏损票 中位数）=====")
for k in ['cheatTop1HoldCircPct','cheatTop2HoldSupplyPct','top2HolderCircPct','top1HolderCircPct',
          'cheatSameBlockHoldPct','bundleClusterHoldCircPct','holdersExDust','holders','buyWallets',
          'cheatRouterEntryBuyPct','tradesRouterPct','famousCopyWalletCircPct','bigHolderShare','smartBotCount',
          '卖出占比10s','买入占比10s','actNetBnb_','actBuyers','actSellers','actTraders',
          'tradesNetBuyRatioShortWin','tradesNetBuyRatioLongWin','cheatSlowGrindPump','cheatActivityLevel']:
    wv = sorted(getany(t,k) for t in win if getany(t,k) is not None)
    lv = sorted(getany(t,k) for t in los if getany(t,k) is not None)
    if not wv or not lv:
        print(f"  {k:<30} 覆盖不足 (盈{len(wv)}/亏{len(lv)})"); continue
    wm, lm = wv[len(wv)//2], lv[len(lv)//2]
    print(f"  {k:<30} 盈利med={wm:>10.4g}  亏损med={lm:>10.4g}   盈[{wv[0]:.3g},{wv[-1]:.3g}] 亏[{lv[0]:.3g},{lv[-1]:.3g}]")

# ---- 盈利 11 张逐票画像 ----
print("\n===== 盈利 11 张逐票画像 =====")
for t in sorted(win, key=lambda x:-x['net']):
    f = t['factors']
    hold = ( __import__('datetime').datetime.fromisoformat(t['lastAt']) - __import__('datetime').datetime.fromisoformat(t['firstBuyAt']) ).total_seconds()
    print(f"  {t['symbol'][:12]:<14} {t['net']:+.4f} act={f.get('actTotalBnb'):.2f} 卖占10s={(getany(t,'卖出占比10s') or 0):.0f}% "
          f"top2={getf(t,'top2HolderCircPct') or 0:.0f} cheatTop1={getf(t,'cheatTop1HoldCircPct') or 0:.0f} "
          f"holdersExDust={getf(t,'holdersExDust') or 0:.0f} age={getf(t,'tokenAgeSec'):.0f}s hold={hold:.0f}s "
          f"nSells={t['nSells']} leg={ (t.get('strategyName') or '?').split()[1] if t.get('strategyName') else '?'}")
