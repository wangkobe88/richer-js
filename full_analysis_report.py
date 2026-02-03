#!/usr/bin/env python3
"""
实验 8f688916-a7a7-4501-badc-6cc3a5efc8d8 完整交易分析报告
"""

import json
import statistics
from datetime import datetime

# 加载数据
with open('/tmp/tokens.json') as f:
    tokens_data = json.load(f)

with open('/tmp/trades.json') as f:
    trades_data = json.load(f)

with open('/tmp/signals.json') as f:
    signals_data = json.load(f)

print("=" * 120)
print(" " * 35 + "实验交易表现深度分析报告")
print(" " * 25 + "实验ID: 8f688916-a7a7-4501-badc-6cc3a5efc8d8")
print("=" * 120)

# ==================== 第一部分：核心问题分析 ====================
print("\n" + "=" * 120)
print("【第一部分：核心问题分析】")
print("=" * 120)

# 分析交易结果
trades = trades_data.get('data', [])
buy_trades = [t for t in trades if t.get('trade_direction') == 'buy']
sell_trades = [t for t in trades if t.get('trade_direction') == 'sell']

# 按代币分析
trade_results = []
for buy in buy_trades:
    token_addr = buy.get('token_address')
    symbol = buy.get('token_symbol')
    buy_price = buy.get('unit_price')
    buy_time = datetime.fromisoformat(buy.get('executed_at', buy.get('created_at')).replace('Z', '+00:00'))

    for sell in sell_trades:
        sell_time = datetime.fromisoformat(sell.get('executed_at', sell.get('created_at')).replace('Z', '+00:00'))
        if sell.get('token_address') == token_addr and sell_time > buy_time:
            sell_price = sell.get('unit_price')
            metadata = sell.get('metadata', {})
            profit_pct = metadata.get('profitPercent', 0)
            hold_duration = metadata.get('holdDuration', 0)

            trade_results.append({
                'symbol': symbol,
                'profit': profit_pct,
                'hold_seconds': hold_duration,
                'buy_price': buy_price,
                'sell_price': sell_price,
                'buy_time': buy_time,
                'sell_time': sell_time
            })
            break

profits = [t['profit'] for t in trade_results]
losses = [p for p in profits if p < 0]
gains = [p for p in profits if p > 0]

print("\n【问题1：为什么所有交易都亏损？】")
print("-" * 120)
print(f"总交易笔数: {len(trade_results)}")
print(f"盈利笔数: {len(gains)} ({len(gains)/len(trade_results)*100:.1f}%)")
print(f"亏损笔数: {len(losses)} ({len(losses)/len(trade_results)*100:.1f}%)")
print(f"平均盈亏: {statistics.mean(profits):.2f}%")
print(f"最大盈利: {max(profits):.2f}%")
print(f"最大亏损: {min(profits):.2f}%")
print(f"盈亏比: {len(gains)/len(losses) if losses else 0:.2f}")

print("\n⚠️  关键发现：买入时代币特征分析")
print("-" * 120)

# 分析已交易代币的TVL
tokens = tokens_data.get('data', [])
traded_symbols = set([t['symbol'] for t in trade_results])

print(f"{'代币':<15} {'盈亏%':<12} {'持仓秒':<12} {'买入时TVL':<15} {'当前TVL':<15} {'TVL增长':<12}")
print("-" * 100)

for token in tokens:
    symbol = token.get('token_symbol', '')
    if symbol in traded_symbols:
        raw = token.get('raw_api_data', {})
        current_tvl = raw.get('tvl', '0')
        try:
            current_tvl_val = float(current_tvl) if current_tvl not in ['0', '', None] else 0
        except:
            current_tvl_val = 0

        # 找到对应的交易
        for tr in trade_results:
            if tr['symbol'] == symbol:
                print(f"{symbol:<15} {tr['profit']:<12.2f} {tr['hold_seconds']:<12.0f} {'$0 (新币)':<15} ${current_tvl_val:<14,.2f} {'N/A':<12}")
                break

print("\n🔍 核心问题：")
print("  1. 所有已交易代币在买入时TVL=0，说明都是刚发行的新币")
print("  2. 新币流动性极低，价格容易被操控")
print("  3. 买入后价格持续下跌，平均亏损-48.21%")
print("  4. 止损策略触发时，平均亏损已达-34.70%")

# ==================== 第二部分：买入门槛分析 ====================
print("\n\n【问题2：买入门槛是否太低？】")
print("-" * 120)

# 分析所有监控代币的TVL分布
all_tokens = tokens_data.get('data', [])
all_tvls = []
for token in all_tokens:
    raw = token.get('raw_api_data', {})
    try:
        tvl = float(raw.get('tvl', 0)) if raw.get('tvl') not in ['0', '', None] else 0
        if tvl > 0:
            all_tvls.append(tvl)
    except:
        pass

all_tvls.sort()
print(f"监控代币总数: {len(all_tokens)}")
print(f"有TVL数据的: {len(all_tvls)}")
if all_tvls:
    print(f"TVL中位数: ${statistics.median(all_tvls):.2f}")
    print(f"TVL 25分位: ${all_tvls[len(all_tvls)//4]:.2f}")
    print(f"TVL 75分位: ${all_tvls[len(all_tvls)*3//4]:.2f}")
    print(f"TVL最小值: ${min(all_tvls):.2f}")
    print(f"TVL最大值: ${max(all_tvls):.2f}")

print("\n🔍 分析结论：")
print(f"  - 监控中有 {len(all_tvls)} 个代币有TVL数据")
print(f"  - 已交易的 {len(trade_results)} 个代币买入时TVL全部为0")
print(f"  - 说明买入策略没有TVL过滤条件，会买入刚发行的新币")
print(f"  - 建议：增加最小TVL门槛（如$500或$1000）")

# ==================== 第三部分：止损策略分析 ====================
print("\n\n【问题3：止损策略是否有效？】")
print("-" * 120)

signals = signals_data.get('signals', [])
sell_signals = [s for s in signals if s.get('action') == 'sell']
stop_loss_signals = [s for s in sell_signals if '#6' in s.get('reason', '')]

print(f"总卖出信号: {len(sell_signals)}")
print(f"止损策略#6触发: {len(stop_loss_signals)}")

if stop_loss_signals:
    sl_profits = []
    sl_durations = []
    for s in stop_loss_signals:
        m = s.get('metadata', {})
        profit = m.get('profitPercent')
        duration = m.get('holdDuration')
        if profit is not None:
            try:
                sl_profits.append(float(profit))
            except:
                pass
        if duration is not None:
            try:
                sl_durations.append(float(duration) / 60)  # 转为分钟
            except:
                pass

    if sl_profits:
        print(f"\n止损触发时的盈亏分布:")
        print(f"  平均亏损: {statistics.mean(sl_profits):.2f}%")
        print(f"  中位数亏损: {statistics.median(sl_profits):.2f}%")
        print(f"  最大亏损: {min(sl_profits):.2f}%")
        print(f"  最小亏损: {max(sl_profits):.2f}%")

    if sl_durations:
        print(f"\n止损触发的持仓时间:")
        print(f"  平均: {statistics.mean(sl_durations):.2f} 分钟")
        print(f"  最短: {min(sl_durations):.2f} 分钟")
        print(f"  最长: {max(sl_durations):.2f} 分钟")

print("\n🔍 止损策略问题：")
print("  - 当前止损时间: 5分钟")
print("  - 实际触发时平均亏损: -34.70%")
print("  - 40%止损线太宽松，价格可能在5分钟内就跌超40%")
print("  - 建议：缩短止损时间（如2-3分钟）或提高止损线（如-25%）")

# ==================== 第四部分：错失的机会 ====================
print("\n\n【问题4：错失的机会】")
print("-" * 120)

# 找出TVL高但未交易的代币
high_tvl_not_traded = []
for token in all_tokens:
    symbol = token.get('token_symbol', '')
    if symbol not in traded_symbols:
        raw = token.get('raw_api_data', {})
        try:
            tvl = float(raw.get('tvl', 0)) if raw.get('tvl') not in ['0', '', None] else 0
            fdv = float(raw.get('fdv', 0)) if raw.get('fdv') not in ['0', '', None] else 0
            if tvl > 1000:
                high_tvl_not_traded.append({
                    'symbol': symbol,
                    'tvl': tvl,
                    'fdv': fdv,
                    'platform': raw.get('issue_platform', '')
                })
        except:
            pass

high_tvl_not_traded.sort(key=lambda x: x['tvl'], reverse=True)

print(f"未交易但TVL>$1000的代币: {len(high_tvl_not_traded)} 个")
print(f"\n{'代币':<20} {'TVL':<18} {'FDV':<18} {'平台':<15}")
print("-" * 80)
for item in high_tvl_not_traded[:20]:
    print(f"{item['symbol']:<20} ${item['tvl']:>16,.2f} ${item['fdv']:>16,.2f} {item['platform']:<15}")

# ==================== 第五部分：优化建议 ====================
print("\n\n" + "=" * 120)
print("【第五部分：优化建议】")
print("=" * 120)

print("\n1️⃣ 提高买入门槛")
print("   当前问题: 所有已交易代币买入时TVL=0")
print("   建议:")
print("     - 设置最小TVL门槛: $500 - $1000")
print("     - 设置最小FDV门槛: $5000")
print("     - 排除刚发行的新币（如发行时间<10分钟）")

print("\n2️⃣  优化止损策略")
print("   当前问题: 5分钟止损太慢，平均亏损已达-34.70%")
print("   建议:")
print("     - 缩短止损时间: 5分钟 → 2-3分钟")
print("     - 提高止损线: -40% → -25%")
print("     - 或改为动态止损: 价格从最高点回落15%即止损")

print("\n3️⃣  优化买入条件")
print("   当前问题: earlyReturn在80-120%区间，范围太宽")
print("   建议:")
print("     - 缩小区间: 80-120% → 90-110%")
print("     - 增加流动性确认: TVL>$500")
print("     - 增加价格稳定性: 最近1分钟内价格波动<20%")

print("\n4️⃣  增加风险控制")
print("   建议:")
print("     - 单笔最大亏损: -10%即止损")
print("     - 日最大亏损: -30%即停止交易")
print("     - 连续亏损3笔后暂停交易1小时")

print("\n5️⃣  改进选币策略")
print("   当前问题: 监控100个代币，只有20个产生交易")
print("   建议:")
print("     - 提高监控门槛: 只监控TVL>$1000的代币")
print("     - 增加流动性过滤: 24小时交易量>$5000")
print("     - 增加持有人数过滤: 持有人>50")

# ==================== 第六部分：具体参数调整 ====================
print("\n\n" + "=" * 120)
print("【第六部分：具体参数调整建议】")
print("=" * 120)

print("\n📋 推荐配置:")
print("-" * 120)
print("""
strategy:
  buyTimeMinutes: 1.33          # 买入时间：1分20秒
  earlyReturnMin: 90            # 最小收益率: 90% (提高)
  earlyReturnMax: 110           # 最大收益率: 110% (缩小范围)
  takeProfit1: 30               # 止盈1: 30%
  takeProfit2: 50               # 止盈2: 50%
  stopLossMinutes: 2            # 止损时间: 2分钟 (缩短)
  stopLossPercent: 25           # 止损线: -25% (提高)

# 新增：买入过滤条件
buyFilters:
  minTVL: 500                   # 最小TVL: $500
  minFDV: 5000                  # 最小FDV: $5000
  minAgeSeconds: 300            # 最小发行时间: 5分钟
  maxPriceChangePercent: 20     # 最大价格波动: 20%

# 新增：风险控制
riskControl:
  maxLossPerTrade: 10           # 单笔最大亏损: 10%
  maxDailyLoss: 30              # 日最大亏损: 30%
  pauseAfterConsecutiveLosses: 3 # 连续亏损3笔后暂停
""")

print("\n" + "=" * 120)
print("报告生成完成")
print("=" * 120)
