#!/usr/bin/env python3
# bt-v113 聚焦分析：候选因子具体阈值 + 过滤价值 + 相关性剥离
import json, math

d = json.load(open('/Users/nobody1/Desktop/Codes/richer-js/tmp-fa-bt113.json'))
toks = d['tokens']
N = len(toks)
TOTAL = sum(t['net'] for t in toks)

def getf(t, k):
    v = (t.get('factors') or {}).get(k)
    if v is None: return None
    try: v = float(v)
    except: return None
    if math.isnan(v) or math.isinf(v): return None
    return v

def band(items, label):
    n = len(items)
    if n == 0: return f"  {label:<28} n=0"
    net = sum(t['net'] for t in items)
    wr = sum(1 for t in items if t['net'] > 0)/n
    best = max((t['net'] for t in items), default=0)
    return f"  {label:<28} n={n:<3} net={net:+.4f} ({net/n:+.4f}/票) 胜率={wr*100:.0f}% 最大盈={best:+.3f}"

def bands(key, cuts):
    """cuts: list of (label, predicate)"""
    print(f"\n----- {key} -----")
    used = set()
    for label, pred in cuts:
        items = [t for t in toks if pred(getf(t, key), t)]
        for t in items: used.add(t['token'])
        print(band(items, label))
    rest = [t for t in toks if t['token'] not in used]
    if rest: print(band(rest, '(其余)'))

# 1. 年龄
bands('tokenAgeSec', [
    ('15-25s', lambda v,t: v is not None and v < 25),
    ('25-40s', lambda v,t: v is not None and 25 <= v < 40),
    ('40-90s', lambda v,t: v is not None and 40 <= v < 90),
    ('90-300s', lambda v,t: v is not None and 90 <= v < 300),
    ('>300s', lambda v,t: v is not None and v >= 300),
])

# 2. 价格数据点
bands('trendDataPoints', [
    ('<=3', lambda v,t: v is not None and v <= 3),
    ('4-5', lambda v,t: v is not None and 3 < v <= 5),
    ('>=6', lambda v,t: v is not None and v > 5),
])

# 3. 10s 活动总量
bands('actTotalBnb', [
    ('<0.3', lambda v,t: v is not None and v < 0.3),
    ('0.3-0.6', lambda v,t: v is not None and 0.3 <= v < 0.6),
    ('0.6-1.2', lambda v,t: v is not None and 0.6 <= v < 1.2),
    ('1.2-3', lambda v,t: v is not None and 1.2 <= v < 3),
    ('>=3', lambda v,t: v is not None and v >= 3),
])

# 4. 10s 买额
bands('actBuyBnb', [
    ('<0.25', lambda v,t: v is not None and v < 0.25),
    ('0.25-0.45', lambda v,t: v is not None and 0.25 <= v < 0.45),
    ('0.45-0.8', lambda v,t: v is not None and 0.45 <= v < 0.8),
    ('>=0.8', lambda v,t: v is not None and v >= 0.8),
])

# 5. 急跌速度
bands('crashSpeedPctPerSec', [
    ('<-4 (急跌中)', lambda v,t: v is not None and v < -4),
    ('-4~0 (缓跌)', lambda v,t: v is not None and -4 <= v < 0),
    ('=0 (平稳)', lambda v,t: v is not None and v == 0),
    ('>0', lambda v,t: v is not None and v > 0),
])

# 6. 涨速
bands('riseSpeed', [
    ('<-30 (快速下跌)', lambda v,t: v is not None and v < -30),
    ('-30~0', lambda v,t: v is not None and -30 <= v < 0),
    ('0~20 (缓涨)', lambda v,t: v is not None and 0 <= v < 20),
    ('>=20 (快涨/追高)', lambda v,t: v is not None and v >= 20),
])

# 7. 触发键 recentBlockDropPct
bands('recentBlockDropPct', [
    ('<5', lambda v,t: v is not None and v < 5),
    ('5-13', lambda v,t: v is not None and 5 <= v < 13),
    ('>=13', lambda v,t: v is not None and v >= 13),
])

# 8. 首块占比
bands('firstBlockBuyShare', [
    ('<0.3', lambda v,t: v is not None and v < 0.3),
    ('0.3-0.56', lambda v,t: v is not None and 0.3 <= v < 0.56),
    ('>=0.56', lambda v,t: v is not None and v >= 0.56),
])

# 9. top2 集中度
bands('top2HolderCircPct', [
    ('<40', lambda v,t: v is not None and v < 40),
    ('40-65', lambda v,t: v is not None and 40 <= v < 65),
    ('>=65', lambda v,t: v is not None and v >= 65),
])

# 10. currentVsLaunchPct
bands('currentVsLaunchPct', [
    ('<0 (破发)', lambda v,t: v is not None and v < 0),
    ('0-10', lambda v,t: v is not None and 0 <= v < 10),
    ('10-20', lambda v,t: v is not None and 10 <= v < 20),
    ('>=20', lambda v,t: v is not None and v >= 20),
])

# ---- 相关性剥离：年龄 vs 活动族 ----
print("\n===== 年龄 × actTotalBnb 交叉 =====")
for a_label, a_pred in [('age<40', lambda t: getf(t,'tokenAgeSec') < 40), ('age>=40', lambda t: getf(t,'tokenAgeSec') >= 40)]:
    for h_label, h_pred in [('act<0.6', lambda t: getf(t,'actTotalBnb') < 0.6), ('act>=0.6', lambda t: getf(t,'actTotalBnb') >= 0.6)]:
        items = [t for t in toks if a_pred(t) and h_pred(t)]
        print(band(items, f"{a_label} & {h_label}"))

print("\n===== trendDataPoints × actTotalBnb 交叉 =====")
for a_label, a_pred in [('dp<=3', lambda t: (getf(t,'trendDataPoints') or 0) <= 3), ('dp>3', lambda t: (getf(t,'trendDataPoints') or 0) > 3)]:
    for h_label, h_pred in [('act<0.6', lambda t: getf(t,'actTotalBnb') < 0.6), ('act>=0.6', lambda t: getf(t,'actTotalBnb') >= 0.6)]:
        items = [t for t in toks if a_pred(t) and h_pred(t)]
        print(band(items, f"{a_label} & {h_label}"))

# ---- 候选过滤规则的总体价值 ----
print("\n===== 候选过滤规则（剔除后组合净值 / 误伤盈利票）=====")
rules = [
    ('age<25s 挡', lambda t: getf(t,'tokenAgeSec') is not None and getf(t,'tokenAgeSec') < 25),
    ('actTotalBnb>=1.2 挡', lambda t: getf(t,'actTotalBnb') is not None and getf(t,'actTotalBnb') >= 1.2),
    ('actBuyBnb>=0.45 挡', lambda t: getf(t,'actBuyBnb') is not None and getf(t,'actBuyBnb') >= 0.45),
    ('crashSpeed<-4 挡', lambda t: getf(t,'crashSpeedPctPerSec') is not None and getf(t,'crashSpeedPctPerSec') < -4),
    ('riseSpeed>=20 挡', lambda t: getf(t,'riseSpeed') is not None and getf(t,'riseSpeed') >= 20),
    ('firstBlockBuyShare>=0.56 挡', lambda t: getf(t,'firstBlockBuyShare') is not None and getf(t,'firstBlockBuyShare') >= 0.56),
    ('组合A: age<25 OR actBuy>=0.45', lambda t: (getf(t,'tokenAgeSec') is not None and getf(t,'tokenAgeSec') < 25) or (getf(t,'actBuyBnb') is not None and getf(t,'actBuyBnb') >= 0.45)),
    ('组合B: age<25 OR actBuy>=0.45 OR crash<-4', lambda t: (getf(t,'tokenAgeSec') is not None and getf(t,'tokenAgeSec') < 25) or (getf(t,'actBuyBnb') is not None and getf(t,'actBuyBnb') >= 0.45) or (getf(t,'crashSpeedPctPerSec') is not None and getf(t,'crashSpeedPctPerSec') < -4)),
    ('组合C: actTotal>=1.2 OR crash<-4', lambda t: (getf(t,'actTotalBnb') is not None and getf(t,'actTotalBnb') >= 1.2) or (getf(t,'crashSpeedPctPerSec') is not None and getf(t,'crashSpeedPctPerSec') < -4)),
]
for name, pred in rules:
    excluded = [t for t in toks if pred(t)]
    kept = [t for t in toks if not pred(t)]
    ex_net = sum(t['net'] for t in excluded)
    ex_win = [t for t in excluded if t['net'] > 0]
    kept_net = sum(t['net'] for t in kept)
    kept_wr = sum(1 for t in kept if t['net']>0)/len(kept) if kept else 0
    print(f"  {name:<44} 剔除{len(excluded)}票(亏{sum(1 for t in excluded if t['net']<=0)}/盈{len(ex_win)}, 净{ex_net:+.4f}) → 保留{len(kept)}票 净{kept_net:+.4f} 胜率{kept_wr*100:.0f}%")
    if ex_win:
        print(f"      误伤盈利票: " + ", ".join(f"{t['symbol'][:10]}({t['net']:+.3f})" for t in sorted(ex_win, key=lambda x:-x['net'])[:6]))
