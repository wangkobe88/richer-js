#!/usr/bin/env python3
# bt-v113 因子过滤分析——全因子三分位扫描
import json, math, sys

d = json.load(open('/Users/nobody1/Desktop/Codes/richer-js/tmp-fa-bt113.json'))
toks = d['tokens']
N = len(toks)
total_net = sum(t['net'] for t in toks)

def bucket_stats(items):
    n = len(items)
    net = sum(t['net'] for t in items)
    wins = sum(1 for t in items if t['net'] > 0)
    return n, net, (wins/n if n else 0)

print(f"总样本 {N} 票 | 总净额 {total_net:+.4f} | 胜率 {sum(1 for t in toks if t['net']>0)/N*100:.0f}%")

# ---------- 1. 分类维度 ----------
print("\n===== 分类维度 =====")
for dim in ['strategyName', 'cheatGrade', 'bpPassed', 'bpBucket']:
    groups = {}
    for t in toks:
        k = t.get(dim)
        if isinstance(k, dict): k = k.get('bucket')
        groups.setdefault(str(k), []).append(t)
    if len(groups) < 2: continue
    print(f"\n-- {dim} --")
    for k, items in sorted(groups.items(), key=lambda x: -len(x[1])):
        n, net, wr = bucket_stats(items)
        print(f"  {str(k)[:44]:<46} n={n:<4} net={net:+.4f} ({net/n:+.4f}/票) 胜率={wr*100:.0f}%")

# ---------- 2. 数值因子三分位扫描 ----------
def getf(t, k):
    v = (t.get('factors') or {}).get(k)
    if v is None: return None
    try: v = float(v)
    except: return None
    if math.isnan(v) or math.isinf(v): return None
    return v

factors = {}
for t in toks:
    for k, v in (t.get('factors') or {}).items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            factors.setdefault(k, []).append((t, float(v)))

results = []
for k, pairs in factors.items():
    vals = [(t, v) for t, v in pairs]
    nn = [v for _, v in vals]
    # 覆盖率（相对全样本）
    cov = len(vals) / N
    if cov < 0.5: continue
    # 剔除常量
    distinct = len(set(round(v, 6) for v in nn))
    if distinct < 5: continue
    srt = sorted(vals, key=lambda x: x[1])
    n3 = len(srt)
    q1, q2 = srt[:n3//3], srt[n3//3:2*n3//3]
    q3 = srt[2*n3//3:]
    _, n1, w1 = bucket_stats([t for t, _ in q1])
    _, n3v, w3 = bucket_stats([t for t, _ in q3])
    # 分离度：底桶与顶桶的每票净额差
    avg1 = n1/len(q1) if q1 else 0
    avg3 = n3v/len(q3) if q3 else 0
    sep = avg1 - avg3  # >0 = 因子值低=亏（低值应过滤）；<0 = 高值=亏
    results.append((abs(sep), sep, k, cov, len(q1), n1, w1, len(q3), n3v, w3,
                    q1[0][1], q1[-1][1], q3[0][1], q3[-1][1]))

results.sort(reverse=True)
print(f"\n===== 数值因子三分位扫描（覆盖率≥50%，按底/顶桶每票净额分离度排序，Top 30）=====")
print(f"{'因子':<38} {'cov':>4} {'低1/3净':>9} {'胜率':>4} {'高1/3净':>9} {'胜率':>4} {'低桶区间':>22} {'高桶区间':>22}")
for abssep, sep, k, cov, l, nl, wl, h, nh, wh, lo1, lo2, hi1, hi2 in results[:30]:
    def f(x):
        a = abs(x)
        if a >= 1000: return f"{x:.0f}"
        if a >= 1: return f"{x:.2f}"
        return f"{x:.4g}"
    print(f"{k:<38} {cov*100:>3.0f}% {nl/l:>+9.4f} {wl*100:>3.0f}% {nh/h:>+9.4f} {wh*100:>3.0f}% [{f(lo1)},{f(lo2)}]{'':<{max(0,8)}} [{f(hi1)},{f(hi2)}]")

# ---------- 3. Spearman 相关 ----------
def spearman(pairs):
    srt = sorted(range(len(pairs)), key=lambda i: pairs[i][1])
    rank_v = [0]*len(pairs)
    for r, i in enumerate(srt): rank_v[i] = r
    srt2 = sorted(range(len(pairs)), key=lambda i: pairs[i][0]['net'])
    rank_n = [0]*len(pairs)
    for r, i in enumerate(srt2): rank_n[i] = r
    n = len(pairs)
    d2 = sum((rank_v[i]-rank_n[i])**2 for i in range(n))
    return 1 - 6*d2/(n*(n*n-1))

print(f"\n===== Spearman 相关（|ρ|≥0.22，覆盖率≥60%）=====")
corrs = []
for k, pairs in factors.items():
    if len(pairs) < N*0.6: continue
    distinct = len(set(round(v,6) for _, v in pairs))
    if distinct < 5: continue
    rho = spearman(pairs)
    corrs.append((abs(rho), rho, k, len(pairs)))
corrs.sort(reverse=True)
for a, r, k, n in corrs:
    if a < 0.22: break
    print(f"  {k:<40} ρ={r:+.3f} (n={n})")
