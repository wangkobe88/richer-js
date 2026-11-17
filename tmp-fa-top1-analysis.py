#!/usr/bin/env python3
# top1HoldCircPct 族分析——按窗分层，防关联当因果：
# 1) 覆盖率（cheatTop1HoldCircPct 是 cheat 门投影，首信号票可能 null）
# 2) 分带净额（每窗单独看，不合并）
# 3) B 窗去重（v110/v102 同窗口同票，合并会重复计数）
# 4) 年龄分层（早窗浓度机械偏高——混杂检验）
# 5) 与年龄/买量/热度的相关（它到底在度量什么）
# 6) 因果实轴：creatorFrontRun 档位在 top1 高带内的分化（控盘者身份 vs 浓度本身）
import json, math

D = '/Users/nobody1/Desktop/Codes/richer-js/'
A = json.load(open(D+'tmp-fa-bt113.json'))['tokens']
B1 = json.load(open(D+'tmp-fa-btv110.json'))['tokens']
B2 = json.load(open(D+'tmp-fa-btv102.json'))['tokens']

def g(t, k):
    v = (t.get('factors') or {}).get(k)
    if v is None: return None
    try: v = float(v)
    except: return None
    if math.isnan(v) or math.isinf(v): return None
    return v

def stat(items):
    if not items: return 'n=0'
    n = len(items); net = sum(t['net'] for t in items)
    wr = sum(1 for t in items if t['net'] > 0)/n*100
    return f'n={n:<3} net={net:+.4f} ({net/n:+.4f}/票) 胜率{wr:.0f}%'

def pearson(xs, ys):
    n = len(xs)
    if n < 5: return None
    mx, my = sum(xs)/n, sum(ys)/n
    cov = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    vx = math.sqrt(sum((x-mx)**2 for x in xs)); vy = math.sqrt(sum((y-my)**2 for y in ys))
    if vx == 0 or vy == 0: return None
    return cov/(vx*vy)

# B 窗去重 union（同票保留 v110 行，v110 是现行库跑法）
seen = set(); BU = []
for t in B1 + B2:
    if t['token'] in seen: continue
    seen.add(t['token']); BU.append(t)
overlap = len(B1) + len(B2) - len(BU)

wins = [('A bt-v113', A), ('B v110', B1), ('B v102', B2), ('B 去重union', BU)]
print(f'B 窗 v110={len(B1)} v102={len(B2)} 重叠票={overlap} 去重后={len(BU)}\n')

# ---- 1) 覆盖率 ----
print('== 覆盖率 ==')
for name, toks in wins:
    cov1 = sum(1 for t in toks if g(t,'cheatTop1HoldCircPct') is not None)
    cov2 = sum(1 for t in toks if g(t,'top1HolderSupplyPct') is not None)
    cov3 = sum(1 for t in toks if g(t,'top2HolderCircPct') is not None)
    print(f'  {name:<12} cheatTop1HoldCirc {cov1}/{len(toks)} | top1HolderSupply {cov2}/{len(toks)} | top2HolderCirc {cov3}/{len(toks)}')

# ---- 2) cheatTop1HoldCircPct 分带（有投影子集）----
BANDS = [(0,20),(20,35),(35,50),(50,70),(70,101)]
print('\n== cheatTop1HoldCircPct 分带（仅有投影票）==')
for name, toks in wins:
    print(f'--- {name} ---')
    for lo,hi in BANDS:
        sel = [t for t in toks if g(t,'cheatTop1HoldCircPct') is not None and lo <= g(t,'cheatTop1HoldCircPct') < hi]
        if sel:
            top = max(sel, key=lambda t:t['net'])
            print(f'  [{lo:>3},{hi:>3})  {stat(sel)}   最大盈:{top["symbol"][:8]}{top["net"]:+.3f}')

# ---- 3) 原生键 top1HolderSupplyPct 分带（全覆盖，分母=总供给）----
print('\n== top1HolderSupplyPct 分带（原生全票，÷totalSupply）==')
for name, toks in wins:
    print(f'--- {name} ---')
    vals = sorted(g(t,'top1HolderSupplyPct') for t in toks if g(t,'top1HolderSupplyPct') is not None)
    if not vals: continue
    q1, q2, q3 = vals[len(vals)//4], vals[len(vals)//2], vals[3*len(vals)//4]
    print(f'  分布: min{vals[0]:.1f} q1={q1:.1f} med={q2:.1f} q3={q3:.1f} max{vals[-1]:.1f}')
    for lo,hi in [(0,q2),(q2,10**9)]:
        sel = [t for t in toks if g(t,'top1HolderSupplyPct') is not None and lo <= g(t,'top1HolderSupplyPct') < hi]
        print(f'  top1Supply [{lo:.1f},{hi if hi<10**8 else "max"})  {stat(sel)}')
    # 高位带细化
    his = [t for t in toks if g(t,'top1HolderSupplyPct') is not None and g(t,'top1HolderSupplyPct') >= q3]
    if his: print(f'  高四分位段  {stat(his)}')

# ---- 4) 年龄分层下的 top1 效应（混杂检验）----
print('\n== cheatTop1HoldCircPct × 年龄 分层（A 窗 + B 去重）==')
for name, toks in [('A bt-v113', A), ('B 去重union', BU)]:
    have = [t for t in toks if g(t,'cheatTop1HoldCircPct') is not None]
    if len(have) < 15: print(f'  {name}: 有投影票不足({len(have)})'); continue
    med = sorted(g(t,'cheatTop1HoldCircPct') for t in have)[len(have)//2]
    print(f'--- {name}（中位浓度 {med:.1f}%，覆盖 {len(have)}/{len(toks)}）---')
    for a_lo, a_hi, lab in [(0,45,'age<45s'),(45,10**9,'age>=45s')]:
        for c_lo, c_hi, clab in [(0,med,'低浓度'),(med,101,'高浓度')]:
            sel = [t for t in have if a_lo <= (g(t,'tokenAgeSec') or 0) < a_hi and c_lo <= g(t,'cheatTop1HoldCircPct') < c_hi]
            print(f'  {lab:<9} ∩ {clab}  {stat(sel)}')

# ---- 5) 相关性：cheatTop1HoldCircPct 与年龄/买量/热度/持有人 ----
print('\n== cheatTop1HoldCircPct 相关性（皮尔逊，各有投影票内）==')
for name, toks in [('A bt-v113', A), ('B 去重union', BU)]:
    have = [t for t in toks if g(t,'cheatTop1HoldCircPct') is not None]
    row = f'  {name:<12}'
    for k in ['tokenAgeSec','buyVolumeBnb','actTotalBnb','holdersExDust','currentVsLaunchPct']:
        xs = [g(t,'cheatTop1HoldCircPct') for t in have if g(t,k) is not None]
        ys = [g(t,k) for t in have if g(t,k) is not None]
        r = pearson(xs, ys)
        row += f'  {k}={r:+.2f}' if r is not None else f'  {k}=NA'
    print(row + f'   (n={len(have)})')

# ---- 6) 因果实轴：高浓度带内 creatorFrontRun 档位分化 ----
print('\n== 高浓度（cheatTop1HoldCircPct>=50）内 creatorFrontRun 分化 ==')
for name, toks in [('A bt-v113', A), ('B 去重union', BU)]:
    hi = [t for t in toks if (g(t,'cheatTop1HoldCircPct') or 0) >= 50]
    fr3 = [t for t in hi if g(t,'cheatCreatorFrontRun') == 3]
    fr0 = [t for t in hi if g(t,'cheatCreatorFrontRun') is not None and g(t,'cheatCreatorFrontRun') < 3]
    print(f'  {name:<12} 高浓度 {stat(hi)} | frontRun=strong {stat(fr3)} | frontRun<strong {stat(fr0)}')
    if hi:
        print('    明细: ' + '; '.join(f"{t['symbol'][:8]}({t['net']:+.3f},top1={g(t,'cheatTop1HoldCircPct'):.0f},fr={g(t,'cheatCreatorFrontRun')})" for t in sorted(hi,key=lambda x:x['net'])))

# ---- 7) 去大赢家稳健性：B 去重 union 去 memes 后高浓度带还剩什么 ----
print('\n== 去 memes 稳健性（B 去重 union）==')
nome = [t for t in BU if t['symbol'] != 'memes']
for lo,hi in [(0,35),(35,50),(50,101)]:
    sel = [t for t in nome if g(t,'cheatTop1HoldCircPct') is not None and lo <= g(t,'cheatTop1HoldCircPct') < hi]
    print(f'  [{lo},{hi})  {stat(sel)}')
