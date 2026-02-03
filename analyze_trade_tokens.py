#!/usr/bin/env python3
import json
from collections import defaultdict

# 获取数据
with open('/tmp/tokens.json') as f:
    tokens_data = json.load(f)

with open('/tmp/trades.json') as f:
    trades_data = json.load(f)

# 建立代币地址到raw_api_data的映射
token_info = {}
for token in tokens_data.get('data', []):
    addr = token.get('token_address')
    token_info[addr] = {
        'symbol': token.get('token_symbol'),
        'raw': token.get('raw_api_data', {})
    }

# 分析交易
trades = trades_data.get('data', [])
trades_by_token = defaultdict(list)

for trade in trades:
    token_addr = trade.get('token_address')
    trades_by_token[token_addr].append(trade)

print('已交易代币的完整分析:')
print('=' * 140)
print(f"{'代币':<15} {'TVL':<15} {'FDV':<15} {'平台':<15} {'盈亏%':<12} {'持仓小时':<12} {'买入原因':<20}")
print('-' * 140)

profitable_tokens = []
loss_tokens = []

for token_addr, token_trades in trades_by_token.items():
    buy_trades = [t for t in token_trades if t.get('trade_direction') == 'buy']
    sell_trades = [t for t in token_trades if t.get('trade_direction') == 'sell']

    if buy_trades and sell_trades:
        buy = buy_trades[0]
        sell = sell_trades[0]

        symbol = buy.get('token_symbol', '')

        # 从tokens数据获取raw_api_data
        info = token_info.get(token_addr, {})
        raw = info.get('raw', {})

        tvl = raw.get('tvl', '0')
        fdv = raw.get('fdv', '0')
        platform = raw.get('issue_platform', 'unknown')

        sell_metadata = sell.get('metadata', {})
        profit = sell_metadata.get('profitPercent', 0)
        hold_duration = sell_metadata.get('holdDuration', 0) / 3600  # 转为小时

        # 买入原因从信号中获取
        buy_signal = buy.get('reason', 'N/A')

        row = {
            'symbol': symbol,
            'tvl': tvl,
            'fdv': fdv,
            'platform': platform,
            'profit': profit,
            'hold_hours': hold_duration,
            'buy_reason': buy_signal
        }

        if profit > 0:
            profitable_tokens.append(row)
        else:
            loss_tokens.append(row)

# 先打印亏损的
for row in sorted(loss_tokens, key=lambda x: x['profit']):
    print(f"{row['symbol']:<15} ${row['tvl']:<14} ${row['fdv']:<14} {row['platform']:<15} {row['profit']:<12.2f} {row['hold_hours']:<12.2f} {row['buy_reason']:<20}")

print('\n盈利的代币:')
print('-' * 140)
for row in sorted(profitable_tokens, key=lambda x: -x['profit']):
    print(f"{row['symbol']:<15} ${row['tvl']:<14} ${row['fdv']:<14} {row['platform']:<15} {row['profit']:<12.2f} {row['hold_hours']:<12.2f} {row['buy_reason']:<20}")

# 统计分析
print('\n\n' + '=' * 80)
print('关键发现:')
print('=' * 80)

# 亏损代币的TVL分布
loss_tvls = [float(r['tvl']) for r in loss_tokens if r['tvl'] != '0' and r['tvl'] != '']
profit_tvls = [float(r['tvl']) for r in profitable_tokens if r['tvl'] != '0' and r['tvl'] != '']

print(f'\n亏损代币 TVL 分析:')
if loss_tvls:
    print(f'  有TVL数据的: {len(loss_tvls)} 个')
    print(f'  平均TVL: ${sum(loss_tvls)/len(loss_tvls):.2f}')
    print(f'  最大TVL: ${max(loss_tvls):.2f}')

print(f'\n盈利代币 TVL 分析:')
if profit_tvls:
    print(f'  有TVL数据的: {len(profit_tvls)} 个')
    print(f'  平均TVL: ${sum(profit_tvls)/len(profit_tvls):.2f}')
    print(f'  最大TVL: ${max(profit_tvls):.2f}')

# 盈利代币的持仓时间
profit_holds = [r['hold_hours'] for r in profitable_tokens]
loss_holds = [r['hold_hours'] for r in loss_tokens]

print(f'\n盈利代币平均持仓: {sum(profit_holds)/len(profit_holds):.2f} 小时')
print(f'亏损代币平均持仓: {sum(loss_holds)/len(loss_holds):.2f} 小时')
