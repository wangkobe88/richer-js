#!/usr/bin/env python3
"""
分析实验 8f688916-a7a7-4501-badc-6cc3a5efc8d8 的交易表现
"""

import json
import requests
from datetime import datetime
from collections import defaultdict
import statistics

def fetch_data(experiment_id):
    """获取所有实验数据"""
    base_url = "http://localhost:3010/api/experiment"
    endpoints = {
        'tokens': f"{base_url}/{experiment_id}/tokens",
        'signals': f"{base_url}/{experiment_id}/signals?limit=500",
        'trades': f"{base_url}/{experiment_id}/trades",
        'portfolio': f"{base_url}/{experiment_id}/portfolio"
    }

    data = {}
    for key, url in endpoints.items():
        try:
            response = requests.get(url, timeout=30)
            data[key] = response.json()
            print(f"✓ 获取 {key}: {len(data[key].get('data', data[key].get('signals', data[key].get('snapshots', []))))} 条记录")
        except Exception as e:
            print(f"✗ 获取 {key} 失败: {e}")
            data[key] = {}

    return data

def safe_float(value, default=0):
    """安全转换为浮点数"""
    try:
        return float(value) if value not in [None, '', '0', 'null'] else default
    except (ValueError, TypeError):
        return default

def safe_int(value, default=0):
    """安全转换为整数"""
    try:
        return int(value) if value not in [None, '', '0', 'null'] else default
    except (ValueError, TypeError):
        return default

def analyze_tokens(tokens_data):
    """分析代币数据"""
    tokens = tokens_data.get('data', [])

    # 按状态分类
    by_status = defaultdict(list)
    for token in tokens:
        status = token.get('status', 'unknown')
        by_status[status].append(token)

    # 分析TVL分布
    tvl_data = []
    fdv_data = []

    for token in tokens:
        raw = token.get('raw_api_data', {})
        tvl = safe_float(raw.get('tvl', ''))
        fdv = safe_float(raw.get('fdv', ''))
        if tvl > 0:
            tvl_data.append(tvl)
        if fdv > 0:
            fdv_data.append(fdv)

    tvl_data.sort()
    fdv_data.sort()

    return {
        'total': len(tokens),
        'by_status': {k: len(v) for k, v in by_status.items()},
        'tvl_stats': {
            'count': len(tvl_data),
            'min': min(tvl_data) if tvl_data else 0,
            'max': max(tvl_data) if tvl_data else 0,
            'median': statistics.median(tvl_data) if tvl_data else 0,
            'p25': tvl_data[len(tvl_data)//4] if len(tvl_data) >= 4 else 0,
            'p75': tvl_data[len(tvl_data)*3//4] if len(tvl_data) >= 4 else 0,
        },
        'fdv_stats': {
            'count': len(fdv_data),
            'min': min(fdv_data) if fdv_data else 0,
            'max': max(fdv_data) if fdv_data else 0,
            'median': statistics.median(fdv_data) if fdv_data else 0,
        }
    }

def analyze_trades_and_signals(trades_data, signals_data):
    """分析交易和信号"""
    trades = trades_data.get('data', [])
    signals = signals_data.get('signals', [])

    # 按代币分组交易
    trades_by_token = defaultdict(list)
    for trade in trades:
        token_addr = trade.get('token_address')
        trades_by_token[token_addr].append(trade)

    # 分析每一对买卖
    trade_pairs = []
    for token_addr, token_trades in trades_by_token.items():
        buy_trades = [t for t in token_trades if t.get('trade_direction') == 'buy']
        sell_trades = [t for t in token_trades if t.get('trade_direction') == 'sell']

        for buy in buy_trades:
            buy_metadata = buy.get('metadata', {})
            buy_price = safe_float(buy_metadata.get('buyPrice', buy.get('unit_price')))
            buy_time = datetime.fromisoformat(buy.get('executed_at', buy.get('created_at')).replace('Z', '+00:00'))

            # 找到对应的卖出
            for sell in sell_trades:
                sell_time = datetime.fromisoformat(sell.get('executed_at', sell.get('created_at')).replace('Z', '+00:00'))
                if sell_time > buy_time:
                    sell_metadata = sell.get('metadata', {})
                    profit_pct = safe_float(sell_metadata.get('profitPercent', 0))
                    hold_duration = safe_float(sell_metadata.get('holdDuration', 0))

                    # 获取代币信息
                    raw_api_data = sell.get('raw_api_data', {})

                    trade_pairs.append({
                        'token_address': token_addr,
                        'token_symbol': buy.get('token_symbol'),
                        'buy_price': buy_price,
                        'sell_price': sell.get('unit_price'),
                        'profit_percent': profit_pct,
                        'hold_duration_hours': hold_duration / 3600 if hold_duration else 0,
                        'buy_time': buy_time,
                        'sell_time': sell_time,
                        'tvl': safe_float(raw_api_data.get('tvl', '')),
                        'fdv': safe_float(raw_api_data.get('fdv', '')),
                        'input_amount_bnb': safe_float(buy.get('input_amount')),
                        'output_amount_bnb': safe_float(sell.get('output_amount')),
                    })
                    break

    # 分析卖出信号
    sell_signals = [s for s in signals if s.get('action') == 'sell']

    # 按原因分类
    sell_by_reason = defaultdict(list)
    for signal in sell_signals:
        reason = signal.get('reason', 'unknown')
        sell_by_reason[reason].append(signal)

    # 止损分析
    stop_loss_signals = [s for s in sell_signals if '卖出策略 #6' in s.get('reason', '')]
    stop_loss_profits = []
    hold_durations = []

    for signal in stop_loss_signals:
        metadata = signal.get('metadata', {})
        profit = safe_float(metadata.get('profitPercent', 0))
        duration = safe_float(metadata.get('holdDuration', 0))
        stop_loss_profits.append(profit)
        hold_durations.append(duration / 3600)  # 转换为小时

    return {
        'total_trades': len(trades),
        'trade_pairs': trade_pairs,
        'sell_signals_count': len(sell_signals),
        'sell_by_reason': {k: len(v) for k, v in sell_by_reason.items()},
        'stop_loss': {
            'count': len(stop_loss_signals),
            'profits': stop_loss_profits,
            'avg_profit': statistics.mean(stop_loss_profits) if stop_loss_profits else 0,
            'min_profit': min(stop_loss_profits) if stop_loss_profits else 0,
            'max_profit': max(stop_loss_profits) if stop_loss_profits else 0,
            'avg_hold_hours': statistics.mean(hold_durations) if hold_durations else 0,
            'min_hold_hours': min(hold_durations) if hold_durations else 0,
            'max_hold_hours': max(hold_durations) if hold_durations else 0,
        }
    }

def compare_traded_vs_monitored(tokens_data, traded_tokens):
    """对比已交易和未交易代币"""
    tokens = tokens_data.get('data', [])

    traded_addrs = set(t['token_address'] for t in traded_tokens)

    traded_token_details = []
    monitored_only = []

    for token in tokens:
        raw = token.get('raw_api_data', {})
        token_addr = token.get('token_address')
        tvl = safe_float(raw.get('tvl', ''))
        fdv = safe_float(raw.get('fdv', ''))

        info = {
            'address': token_addr,
            'symbol': token.get('token_symbol'),
            'status': token.get('status'),
            'tvl': tvl,
            'fdv': fdv,
            'launch_at': safe_int(raw.get('launch_at', 0)),
            'issue_platform': raw.get('issue_platform', ''),
            'discovered_at': token.get('discovered_at'),
        }

        if token_addr in traded_addrs:
            traded_token_details.append(info)
        else:
            monitored_only.append(info)

    # 计算TVL和FDV的统计
    traded_tvls = [t['tvl'] for t in traded_token_details if t['tvl'] > 0]
    monitored_tvls = [t['tvl'] for t in monitored_only if t['tvl'] > 0]

    traded_fdvs = [t['fdv'] for t in traded_token_details if t['fdv'] > 0]
    monitored_fdvs = [t['fdv'] for t in monitored_only if t['fdv'] > 0]

    return {
        'traded': {
            'count': len(traded_token_details),
            'avg_tvl': statistics.mean(traded_tvls) if traded_tvls else 0,
            'median_tvl': statistics.median(traded_tvls) if traded_tvls else 0,
            'avg_fdv': statistics.mean(traded_fdvs) if traded_fdvs else 0,
            'median_fdv': statistics.median(traded_fdvs) if traded_fdvs else 0,
            'tokens': traded_token_details[:10],  # 只返回前10个
        },
        'monitored_only': {
            'count': len(monitored_only),
            'avg_tvl': statistics.mean(monitored_tvls) if monitored_tvls else 0,
            'median_tvl': statistics.median(monitored_tvls) if monitored_tvls else 0,
            'avg_fdv': statistics.mean(monitored_fdvs) if monitored_fdvs else 0,
            'median_fdv': statistics.median(monitored_fdvs) if monitored_fdvs else 0,
            'tokens': monitored_only[:20],  # 只返回前20个
        }
    }

def print_report(data, analysis):
    """打印分析报告"""
    print("\n" + "="*80)
    print(" " * 25 + "实验交易表现深度分析报告")
    print("="*80)

    # 1. 代币概览
    print("\n【一、代币概览】")
    tokens_analysis = analysis['tokens']
    print(f"总代币数: {tokens_analysis['total']}")
    print(f"按状态分类:")
    for status, count in tokens_analysis['by_status'].items():
        print(f"  - {status}: {count}")

    print(f"\nTVL 分析 (有TVL数据的代币):")
    if tokens_analysis['tvl_stats']['count'] > 0:
        print(f"  - 数量: {tokens_analysis['tvl_stats']['count']}")
        print(f"  - 最小值: ${tokens_analysis['tvl_stats']['min']:,.2f}")
        print(f"  - 25分位: ${tokens_analysis['tvl_stats']['p25']:,.2f}")
        print(f"  - 中位数: ${tokens_analysis['tvl_stats']['median']:,.2f}")
        print(f"  - 75分位: ${tokens_analysis['tvl_stats']['p75']:,.2f}")
        print(f"  - 最大值: ${tokens_analysis['tvl_stats']['max']:,.2f}")

    print(f"\nFDV 分析:")
    if tokens_analysis['fdv_stats']['count'] > 0:
        print(f"  - 数量: {tokens_analysis['fdv_stats']['count']}")
        print(f"  - 最小值: ${tokens_analysis['fdv_stats']['min']:,.2f}")
        print(f"  - 中位数: ${tokens_analysis['fdv_stats']['median']:,.2f}")
        print(f"  - 最大值: ${tokens_analysis['fdv_stats']['max']:,.2f}")

    # 2. 交易分析
    print("\n【二、交易分析】")
    trades_analysis = analysis['trades']
    trade_pairs = trades_analysis['trade_pairs']

    print(f"总交易数: {trades_analysis['total_trades']}")
    print(f"成交的交易对: {len(trade_pairs)}")

    if trade_pairs:
        profits = [t['profit_percent'] for t in trade_pairs]
        print(f"\n盈亏统计:")
        print(f"  - 总笔数: {len(trade_pairs)}")
        print(f"  - 盈利笔数: {len([p for p in profits if p > 0])}")
        print(f"  - 亏损笔数: {len([p for p in profits if p < 0])}")
        print(f"  - 平均盈亏: {statistics.mean(profits):.2f}%")
        print(f"  - 最大盈利: {max(profits):.2f}%")
        print(f"  - 最大亏损: {min(profits):.2f}%")

        hold_hours = [t['hold_duration_hours'] for t in trade_pairs]
        print(f"\n持仓时间:")
        print(f"  - 平均: {statistics.mean(hold_hours):.2f} 小时")
        print(f"  - 最短: {min(hold_hours):.2f} 小时")
        print(f"  - 最长: {max(hold_hours):.2f} 小时")

    # 3. 卖出信号分析
    print("\n【三、卖出信号分析】")
    print(f"总卖出信号: {trades_analysis['sell_signals_count']}")
    print("按原因分类:")
    for reason, count in trades_analysis['sell_by_reason'].items():
        print(f"  - {reason}: {count}")

    print(f"\n止损策略 #6 分析:")
    sl = trades_analysis['stop_loss']
    print(f"  - 触发次数: {sl['count']}")
    print(f"  - 平均亏损: {sl['avg_profit']:.2f}%")
    print(f"  - 最大亏损: {sl['min_profit']:.2f}%")
    print(f"  - 最小亏损: {sl['max_profit']:.2f}%")
    print(f"  - 平均持仓时间: {sl['avg_hold_hours']:.2f} 小时 ({sl['avg_hold_hours']/24:.2f} 天)")
    print(f"  - 最短持仓: {sl['min_hold_hours']:.2f} 小时")
    print(f"  - 最长持仓: {sl['max_hold_hours']:.2f} 小时")

    # 4. 已交易 vs 未交易代币对比
    print("\n【四、已交易 vs 未交易代币对比】")
    comparison = analysis['comparison']

    print(f"\n已交易代币 ({comparison['traded']['count']} 个):")
    print(f"  - 平均 TVL: ${comparison['traded']['avg_tvl']:,.2f}")
    print(f"  - TVL 中位数: ${comparison['traded']['median_tvl']:,.2f}")
    print(f"  - 平均 FDV: ${comparison['traded']['avg_fdv']:,.2f}")
    print(f"  - FDV 中位数: ${comparison['traded']['median_fdv']:,.2f}")

    print(f"\n仅监控代币 ({comparison['monitored_only']['count']} 个):")
    print(f"  - 平均 TVL: ${comparison['monitored_only']['avg_tvl']:,.2f}")
    print(f"  - TVL 中位数: ${comparison['monitored_only']['median_tvl']:,.2f}")
    print(f"  - 平均 FDV: ${comparison['monitored_only']['avg_fdv']:,.2f}")
    print(f"  - FDV 中位数: ${comparison['monitored_only']['median_fdv']:,.2f}")

    # 5. 详细交易列表
    print("\n【五、详细交易列表】")
    if trade_pairs:
        print(f"{'代币':<15} {'买入价格':<15} {'卖出价格':<15} {'盈亏%':<10} {'持仓小时':<12} {'TVL':<15}")
        print("-" * 95)
        for t in trade_pairs:
            print(f"{t['token_symbol'][:15]:<15} "
                  f"{t['buy_price']:<15.2e} "
                  f"{t['sell_price']:<15.2e} "
                  f"{t['profit_percent']:<10.2f} "
                  f"{t['hold_duration_hours']:<12.2f} "
                  f"${t['tvl']:,.2f}")

    # 6. 买入时特征分析
    print("\n【六、买入代币特征分析】")
    if trade_pairs:
        print(f"{'代币':<15} {'TVL':<15} {'FDV':<15} {'亏损%':<10}")
        print("-" * 65)
        for t in trade_pairs:
            if t['profit_percent'] < 0:  # 只显示亏损的
                print(f"{t['token_symbol'][:15]:<15} "
                      f"${t['tvl']:>13,.2f} "
                      f"${t['fdv']:>13,.2f} "
                      f"{t['profit_percent']:>9.2f}%")

    # 7. 监控中可能错过的机会
    print("\n【七、监控中TVL较高的代币（可能错过的机会）】")
    monitored = comparison['monitored_only']['tokens']
    high_tvl = [t for t in monitored if t['tvl'] > 0]
    high_tvl.sort(key=lambda x: x['tvl'], reverse=True)
    for t in high_tvl[:15]:
        print(f"  {t['symbol']:<20} TVL: ${t['tvl']:>12,.2f}  FDV: ${t['fdv']:>12,.2f}")

def main():
    experiment_id = "8f688916-a7a7-4501-badc-6cc3a5efc8d8"

    print("正在获取数据...")
    # 使用本地文件而不是API
    try:
        with open('/Users/nobody1/Desktop/Codes/richer-js/analyze_data.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        print("✓ 从本地文件读取数据")
    except FileNotFoundError:
        print("✗ 本地数据文件不存在")
        return
    except json.JSONDecodeError:
        print("✗ 数据文件格式错误")
        return

    print("\n正在分析数据...")
    # 构造与原来相同的数据结构
    tokens_data = {'data': []}  # 这里不需要代币数据
    signals_data = {'signals': []}  # 这里不需要信号数据

    analysis = {
        'trades': analyze_trades_and_signals(data, signals_data),
    }

    # 简化报告函数，只输出交易分析
    print_simple_report(data, analysis['trades'])

def print_simple_report(data, trades_analysis):
    """简化的报告函数"""
    trade_pairs = trades_analysis['trade_pairs']

    print("\n" + "="*80)
    print("实验 8f688916-a7a7-4501-badc-6cc3a5efc8d8 交易表现分析")
    print("="*80)
    print()

    # 1. 各代币交易详情
    print("\n【1. 各代币交易详情】")
    print("-"*80)
    print(f"{'代币名称':<12} {'买入价格':<12} {'卖出价格':<12} {'盈亏百分比':<12} {'持仓时间(h)':<12} {'盈亏(BNB)':<15}")
    print("-"*80)

    for t in trade_pairs:
        print(f"{t['token_symbol']:<12} "
              f"{t['buy_price']:<12.8f} "
              f"{t['sell_price']:<12.8f} "
              f"{t['profit_percent']:<+12.2f}% "
              f"{t['hold_duration_hours']:<12.2f} "
              f"{t['output_amount_bnb'] - t['input_amount_bnb']:<+15.8f}")

    # 2. 交易统计
    print("\n【2. 交易统计】")
    print("-"*40)
    if trade_pairs:
        profits = [t['profit_percent'] for t in trade_pairs]
        profitable = len([p for p in profits if p > 0])
        losing = len([p for p in profits if p < 0])

        print(f"总交易次数: {len(trade_pairs)}")
        print(f"盈利交易数: {profitable}")
        print(f"亏损交易数: {losing}")
        print(f"胜率: {profitable/len(trade_pairs)*100:.1f}%")

        hold_hours = [t['hold_duration_hours'] for t in trade_pairs]
        print(f"\n平均持仓时间: {statistics.mean(hold_hours):.2f} 小时")
        print(f"最短持仓时间: {min(hold_hours):.2f} 小时")
        print(f"最长持仓时间: {max(hold_hours):.2f} 小时")

    # 3. 盈亏极值
    if trade_pairs:
        profits = [t['profit_percent'] for t in trade_pairs]
        max_profit = max(profits)
        min_profit = min(profits)
        avg_profit = statistics.mean(profits)

        print("\n【3. 盈亏极值分析】")
        print("-"*40)
        print(f"最大盈利: {max_profit:+.2f}%")
        print(f"最大亏损: {min_profit:+.2f}%")
        print(f"平均盈亏: {avg_profit:+.2f}%")

    # 4. 最佳和最差交易
    print("\n【4. 最佳和最差交易】")
    print("-"*40)

    for t in trade_pairs:
        if t['profit_percent'] == max_profit:
            print(f"🏆 盈利最多的交易: {t['token_symbol']}")
            print(f"   买入价: {t['buy_price']:.8f}")
            print(f"   卖出价: {t['sell_price']:.8f}")
            print(f"   盈利: {t['profit_percent']:.2f}%")
            print(f"   持仓时间: {t['hold_duration_hours']:.2f} 小时")
            print()

        if t['profit_percent'] == min_profit:
            print(f"💸 亏损最多的交易: {t['token_symbol']}")
            print(f"   买入价: {t['buy_price']:.8f}")
            print(f"   卖出价: {t['sell_price']:.8f}")
            print(f"   亏损: {t['profit_percent']:.2f}%")
            print(f"   持仓时间: {t['hold_duration_hours']:.2f} 小时")
            print()

    # 5. 总体盈亏
    if trade_pairs:
        total_investment = sum(t['input_amount_bnb'] for t in trade_pairs)
        total_profit_loss = sum(t['output_amount_bnb'] - t['input_amount_bnb'] for t in trade_pairs)

        print("\n【5. 总体盈亏总结】")
        print("-"*40)
        print(f"总投资成本: {total_investment:.8f} BNB")
        print(f"总卖出收入: {total_investment + total_profit_loss:.8f} BNB")
        print(f"净盈亏: {total_profit_loss:+.8f} BNB")
        print(f"总收益率: {(total_profit_loss/total_investment)*100:+.2f}%")

    # 6. 盈亏分布
    if trade_pairs:
        profits = [t['profit_percent'] for t in trade_pairs]
        profit_ranges = {
            "盈利 > 50%": 0,
            "盈利 20-50%": 0,
            "盈利 0-20%": 0,
            "亏损 0-20%": 0,
            "亏损 > 20%": 0
        }

        for profit in profits:
            if profit > 50:
                profit_ranges["盈利 > 50%"] += 1
            elif profit > 20:
                profit_ranges["盈利 20-50%"] += 1
            elif profit > 0:
                profit_ranges["盈利 0-20%"] += 1
            elif profit > -20:
                profit_ranges["亏损 0-20%"] += 1
            else:
                profit_ranges["亏损 > 20%"] += 1

        print("\n【6. 盈亏分布】")
        print("-"*40)
        for range_name, count in profit_ranges.items():
            print(f"{range_name}: {count} 次 ({count/len(profits)*100:.1f}%)")

    print("\n" + "="*80)
    print("分析完成")

if __name__ == '__main__':
    main()
