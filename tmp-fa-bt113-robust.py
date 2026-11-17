#!/usr/bin/env python3
# bt-v113 稳健性验证
import json, math

d = json.load(open('/Users/nobody1/Desktop/Codes/richer-js/tmp-fa-bt113.json'))
toks = d['tokens']
N = len(toks)

def getf(t, k):
    v = (t.get('factors') or {}).get(k)
    if v is None: return None
    try: v = float(v)
    except: return None
    if math.isnan(v) or math.isinf(v): return None
    return v

def stat(items):
    n = len(items)
    if not n: return "n=0"
    net = sum(t['net'] for t in items)
    wr = sum(1 for t in items if t['net'] > 0)/n
    return f"n={n:<3} net={net:+.4f} ({net/n:+.4f}/票) 胜率={wr*100:.0f}%"

# 1. actTotalBnb 阈值敏感度
print("===== actTotalBnb 上限阈值敏感度（挡 actTotal>=X）=====")
for x in [0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2]:
    kept = [t for t in toks if (getf(t,'actTotalBnb') or 0) < x]
    print(f"  X={x:<5} 保留 {stat(kept)}")

# 2. actBuyBnb 阈值敏感度
print("\n===== actBuyBnb 上限阈值敏感度（挡 actBuy>=X）=====")
for x in [0.3, 0.4, 0.45, 0.5, 0.6, 0.8]:
    kept = [t for t in toks if (getf(t,'actBuyBnb') or 0) < x]
    print(f"  X={x:<5} 保留 {stat(kept)}")

# 3. 按腿分层（P1 vs 非P1）看 actTotal 效应
print("\n===== 按腿分层：actTotal<0.6 vs >=0.6 =====")
for leg in ['P1', 'P2', 'P3', 'P10', '其它']:
    sel = [t for t in toks if (t.get('strategyName') or '').startswith(f'买入策略 {leg}')] if leg != '其它' \
        else [t for t in toks if not any((t.get('strategyName') or '').startswith(f'买入策略 {x}') for x in ['P1','P2','P3','P10'])]
    if not sel: continue
    lo = [t for t in sel if (getf(t,'actTotalBnb') or 0) < 0.6]
    hi = [t for t in sel if (getf(t,'actTotalBnb') or 0) >= 0.6]
    print(f"  [{leg:<4}] 全部: {stat(sel)}")
    print(f"         act<0.6: {stat(lo)} | act>=0.6: {stat(hi)}")

# 4. 时间稳定性：按买入时间分前后两半
times = sorted(t['firstBuyAt'] for t in toks)
mid = times[len(times)//2]
print(f"\n===== 前后半场（中点={mid}）=====")
for label, pred in [('前半', lambda t: t['firstBuyAt'] < mid), ('后半', lambda t: t['firstBuyAt'] >= mid)]:
    sel = [t for t in toks if pred(t)]
    lo = [t for t in sel if (getf(t,'actTotalBnb') or 0) < 0.6]
    hi = [t for t in sel if (getf(t,'actTotalBnb') or 0) >= 0.6]
    dp = [t for t in sel if (getf(t,'trendDataPoints') or 0) > 3 and (getf(t,'actTotalBnb') or 0) < 0.6]
    age = [t for t in sel if (getf(t,'tokenAgeSec') or 0) < 25]
    print(f"  [{label}] 全部: {stat(sel)}")
    print(f"     act<0.6: {stat(lo)} | act>=0.6: {stat(hi)}")
    print(f"     dp>3&act<0.6 好格子: {stat(dp)} | age<25s: {stat(age)}")

# 5. 大赢家剔除稳健性：好格子去掉 top3
print("\n===== 好格子（dp>3 & act<0.6）大赢家剔除 =====")
good = [t for t in toks if (getf(t,'trendDataPoints') or 0) > 3 and (getf(t,'actTotalBnb') or 0) < 0.6]
srt = sorted(good, key=lambda t: -t['net'])
print(f"  全部 {len(good)} 票: 净{sum(t['net'] for t in good):+.4f}")
top3 = srt[:3]
print(f"  top3: " + ", ".join(f"{t['symbol'][:12]}({t['net']:+.3f})" for t in top3))
rest = srt[3:]
print(f"  去top3: {stat(rest)}")
rest2 = srt[6:]
print(f"  去top6: {stat(rest2)}")

# 6. 坏格子构成：act>=0.6 的 48 票都是什么形状
print("\n===== 坏格子（actTotal>=0.6）明细 =====")
bad = [t for t in toks if (getf(t,'actTotalBnb') or 0) >= 0.6]
bad.sort(key=lambda t: t['net'])
print(f"  亏 worst10: " + ", ".join(f"{t['symbol'][:10]}({t['net']:+.3f},act{getf(t,'actTotalBnb'):.1f},age{getf(t,'tokenAgeSec'):.0f}s)" for t in bad[:10]))
print(f"  盈 best6:   " + ", ".join(f"{t['symbol'][:10]}({t['net']:+.3f},act{getf(t,'actTotalBnb'):.1f},age{getf(t,'tokenAgeSec'):.0f}s)" for t in bad[-6:]))

# 7. 双门组合 A 的半场稳健
print("\n===== 组合A（age>=25 AND actBuy<0.45）半场 =====")
combo = lambda t: (getf(t,'tokenAgeSec') or 0) >= 25 and (getf(t,'actBuyBnb') or 0) < 0.45
for label, pred in [('前半', lambda t: t['firstBuyAt'] < mid), ('后半', lambda t: t['firstBuyAt'] >= mid)]:
    sel = [t for t in toks if pred(t) and combo(t)]
    print(f"  [{label}] 保留: {stat(sel)}")

# 8. act 与 cheat/act 桶、DP 之外的第三因子：在好格子内还有没有残余分离
print("\n===== 好格子内残余分离（dp>3 & act<0.6, n=32）=====")
g = good
for k in ['tokenAgeSec', 'currentVsLaunchPct', 'tradesNetBuyRatioShortWin', 'top2HolderCircPct', 'recentBlockDropPct', 'buyVolumeBnb']:
    vals = sorted([(getf(t,k), t) for t in g if getf(t,k) is not None], key=lambda x: x[0])
    if len(vals) < 10: continue
    lo, hi = vals[:len(vals)//2], vals[len(vals)//2:]
    nl = sum(t['net'] for _, t in lo); nh = sum(t['net'] for _, t in hi)
    print(f"  {k:<28} 低半[{vals[0][0]:.2f},{lo[-1][0]:.2f}] 净{nl:+.3f} | 高半[{hi[0][0]:.2f},{vals[-1][0]:.2f}] 净{nh:+.3f}")
