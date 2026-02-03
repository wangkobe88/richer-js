#!/usr/bin/env python3
import json

# 获取代币数据
with open('/tmp/tokens.json') as f:
    data = json.load(f)

tokens = data.get('data', [])

# 从交易中提取已交易的代币
traded_symbols = ['吐刀乐', '燃油', '战生者', '财神爷', 'memU', 'KEN', 'Tencloud', 'CryptoExperts', 'Bubble', '喵斯拉', 'koi', 'FourBall', '珍珠', 'ONEMOLT', '黑洞', '狗自拉', 'Moltverse', 'Yin Horse', '狗王', 'CLAWSEER']

print('已交易代币的原始数据特征:')
print('=' * 120)
print(f"{'代币':<15} {'TVL':<20} {'FDV':<20} {'发行平台':<20} {'发行时间':<15}")
print('-' * 120)

for token in tokens:
    symbol = token.get('token_symbol', '')
    if symbol in traded_symbols:
        raw = token.get('raw_api_data', {})
        tvl = raw.get('tvl', '0')
        fdv = raw.get('fdv', '0')
        platform = raw.get('issue_platform', '')
        launch_at = raw.get('launch_at', 0)
        print(f"{symbol:<15} {tvl:<20} {fdv:<20} {platform:<20} {launch_at}")

# 分析所有代币的TVL分布
print('\n\n所有代币TVL分布:')
print('=' * 100)

all_tvls = []
for token in tokens:
    raw = token.get('raw_api_data', {})
    try:
        tvl = float(raw.get('tvl', 0))
        if tvl > 0:
            all_tvls.append((token.get('token_symbol', ''), tvl))
    except:
        pass

all_tvls.sort(key=lambda x: x[1], reverse=True)
print(f"{'代币':<20} {'TVL':<20}")
print('-' * 40)
for symbol, tvl in all_tvls[:30]:
    print(f"{symbol:<20} ${tvl:>18,.2f}")
