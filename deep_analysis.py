#!/usr/bin/env python3
"""
深入分析实验 8f688916-a7a7-4501-badc-6cc3a5efc8d8
重点分析: 为什么买入的代币都亏损
"""

import json
import statistics
from datetime import datetime

# 加载数据
with open('/tmp/tokens.json') as f:
    tokens_data = json.load(f)

with open('/tmp/trades.json') as f:
    trades_data = json.load(f)

# 处理代币数据，建立映射
token_map = {}
for token in tokens_data.get('data', []):
    addr = token.get('token_address')
    raw = token.get('raw_api_data', {})

    # 解析TVL和FDV
    try:
        tvl = float(raw.get('tvl', 0)) if raw.get('tvl') not in ['0', '', None] else 0
    except:
        tvl = 0

    try:
        fdv = float(raw.get('fdv', 0)) if raw.get('fdv') not in ['0', '', None] else 0
    except:
        fdv = 0

    token_map[addr] = {
        'symbol': token.get('token_symbol'),
        'tvl': tvl,
        'fdv': fdv,
        'platform': raw.get('issue_platform', ''),
        'launch_at': raw.get('launch_at', 0),
        'discovered_at': token.get('discovered_at'),
        'status': token.get('status')
    }

# 分析交易
trades = trades_data.get('data', [])
buy_trades = [t for t in trades if t.get('trade_direction') == 'buy']
sell_trades = [t for t in trades if t.get('trade_direction') == 'sell']

print("=" * 100)
print(" " * 35 + "实验深度分析报告")
print("=" * 100)

# 1. 总体统计
print("\n【一、总体统计】")
print(f"总交易数: {len(trades)}")
print(f"买入交易: {len(buy_trades)}")
print(f"卖出交易: {len(sell_trades)}")

# 2. 按代币分析盈亏
print("\n【二、每笔交易详情】")
print(f"{'代币':<15} {'买入价格':<18} {'卖出价格':<18} {'盈亏%':<10} {'持仓秒':<12} {'TVL':<12} {'FDV':<12}")
print("-" * 110)

trade_results = []

for buy in buy_trades:
    token_addr = buy.get('token_address')
    symbol = buy.get('token_symbol')
    buy_price = buy.get('unit_price')
    buy_time = datetime.fromisoformat(buy.get('executed_at', buy.get('created_at')).replace('Z', '+00:00'))

    # 找到对应的卖出
    for sell in sell_trades:
        sell_time = datetime.fromisoformat(sell.get('executed_at', sell.get('created_at')).replace('Z', '+00:00'))
        if sell.get('token_address') == token_addr and sell_time > buy_time:
            sell_price = sell.get('unit_price')
            metadata = sell.get('metadata', {})
            profit_pct = metadata.get('profitPercent', 0)
            hold_duration = metadata.get('holdDuration', 0)

            # 从token_map获取TVL/FDV
            token_info = token_map.get(token_addr, {})
            tvl = token_info.get('tvl', 0)
            fdv = token_info.get('fdv', 0)

            trade_results.append({
                'symbol': symbol,
                'profit': profit_pct,
                'hold_seconds': hold_duration,
                'tvl': tvl,
                'fdv': fdv,
                'buy_price': buy_price,
                'sell_price': sell_price
            })

            print(f"{symbol:<15} {buy_price:<18.2e} {sell_price:<18.2e} {profit_pct:<10.2f} {hold_duration:<12.0f} ${tvl:<11,.2f} ${fdv:<11,.2f}")
            break

# 3. 盈亏统计
profits = [t['profit'] for t in trade_results]
losses = [p for p in profits if p < 0]
gains = [p for p in profits if p > 0]

print("\n【三、盈亏统计】")
print(f"总交易笔数: {len(trade_results)}")
print(f"盈利笔数: {len(gains)}")
print(f"亏损笔数: {len(losses)}")
print(f"平均盈亏: {statistics.mean(profits):.2f}%")
print(f"最大盈利: {max(profits):.2f}%")
print(f"最大亏损: {min(profits):.2f}%")
print(f"盈亏比: {len(gains)/len(losses) if losses else 0:.2f}")

# 4. 持仓时间分析
hold_times = [t['hold_seconds'] for t in trade_results]
print("\n【四、持仓时间分析】")
print(f"平均持仓: {statistics.mean(hold_times):.0f} 秒 ({statistics.mean(hold_times)/60:.2f} 分钟)")
print(f"最短持仓: {min(hold_times):.0f} 秒")
print(f"最长持仓: {max(hold_times):.0f} 秒 ({max(hold_times)/3600:.2f} 小时)")

# 5. TVL分析
tvls = [t['tvl'] for t in trade_results if t['tvl'] > 0]
print("\n【五、买入代币TVL分析】")
print(f"有TVL数据的代币: {len(tvls)} 个")
if tvls:
    print(f"TVL范围: ${min(tvls):.2f} - ${max(tvls):.2f}")
    print(f"平均TVL: ${statistics.mean(tvls):.2f}")
    print(f"中位数TVL: ${statistics.median(tvls):.2f}")

# 关键发现：所有已交易代币的TVL都是0！
zero_tvl_trades = [t for t in trade_results if t['tvl'] == 0]
print(f"\n⚠️  关键发现: {len(zero_tvl_trades)} 笔交易买入时TVL为0 (流动性极低!)")

# 6. 监控中代币的TVL分布
all_tokens_tvls = [t['tvl'] for t in token_map.values() if t['tvl'] > 0]
print("\n【六、监控中代币TVL分布】")
print(f"总监控代币: {len(token_map)}")
print(f"有TVL数据的: {len(all_tokens_tvls)}")
if all_tokens_tvls:
    all_tokens_tvls_sorted = sorted(all_tokens_tvls)
    print(f"TVL中位数: ${statistics.median(all_tokens_tvls):.2f}")
    print(f"TVL 25分位: ${all_tokens_tvls_sorted[len(all_tokens_tvls_sorted)//4]:.2f}")
    print(f"TVL 75分位: ${all_tokens_tvls_sorted[len(all_tokens_tvls_sorted)*3//4]:.2f}")

# 7. 亏损和盈利交易的持仓时间对比
loss_holds = [t['hold_seconds']/60 for t in trade_results if t['profit'] < 0]
gain_holds = [t['hold_seconds']/60 for t in trade_results if t['profit'] > 0]

print("\n【七、持仓时间对比】")
print(f"亏损交易平均持仓: {statistics.mean(loss_holds):.2f} 分钟")
print(f"盈利交易平均持仓: {statistics.mean(gain_holds):.2f} 分钟")

# 8. 价格变化分析
print("\n【八、价格变化分析】")
price_changes = []
for t in trade_results:
    if t['buy_price'] > 0:
        change = (t['sell_price'] - t['buy_price']) / t['buy_price'] * 100
        price_changes.append(change)

if price_changes:
    print(f"价格下跌平均: {statistics.mean([c for c in price_changes if c < 0]):.2f}%")
    print(f"价格上涨平均: {statistics.mean([c for c in price_changes if c > 0]):.2f}%")

print("\n" + "=" * 100)
