import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

import numpy as np
from analyzers import StockAnalyzer
from factors import CompositeScorer, TrendFactor, VolumeFactor, RSIFactor, ValuationFactor, HotspotFactor

print("=" * 60)
print("模拟数据评分测试")
print("=" * 60)

# 生成模拟K线数据（模拟一只强势上涨的股票）
np.random.seed(42)
base_price = 10.0
kline_data = []
for i in range(60):
    change = np.random.uniform(-0.2, 0.5)  # 偏向上涨
    base_price = max(base_price + change, 5)
    kline_data.append({
        'close': base_price,
        'open': base_price + np.random.uniform(-0.1, 0.1),
        'high': base_price + np.random.uniform(0, 0.3),
        'low': base_price - np.random.uniform(0, 0.3),
        'vol': int(1000000 + i * 10000)
    })

print(f"K线数据: {len(kline_data)}条")
print(f"开盘价: {kline_data[0]['close']:.2f}")
print(f"收盘价: {kline_data[-1]['close']:.2f}")

# 分别测试各因子
print("\n--- 各因子评分 ---")
trend = TrendFactor.calculate(kline_data)
print(f"趋势因子: {trend}")

volume = VolumeFactor.calculate({'量比': 1.5, '换手率': 3}, kline_data)
print(f"成交量因子: {volume}")

rsi = RSIFactor.calculate(kline_data)
print(f"RSI因子: {rsi}")

valuation = ValuationFactor.calculate({'行业': '芯片', 'PE': 60, '年增长率': 40})
print(f"估值因子: {valuation}")

hotspot = HotspotFactor.calculate({'行业': '芯片'}, ['芯片'])
print(f"热点因子: {hotspot}")

# 组合评分
print("\n--- 组合评分 ---")
scorer = CompositeScorer()
stock_data = {
    'code': '600000',
    'name': '测试股票',
    '行业': '芯片',
    'PE': 60,
    '年增长率': 40,
    '量比': 1.5,
    '换手率': 3
}
score_result = scorer.score(stock_data, kline_data, ['芯片'])
print(f"综合评分: {score_result['total']:.1f}")
print(f"通过筛选: {score_result['pass']}")
print(f"标准化分数: {score_result['normalized']}")

# 测试不同评分阈值
print("\n--- 不同阈值测试 ---")
for threshold in [50, 55, 60, 65]:
    pass_count = 0
    for i in range(10):
        np.random.seed(i)
        prices = np.cumprod(1 + np.random.uniform(-0.02, 0.03, 60)) * 10
        kline = [{'close': p, 'vol': 1000000} for p in prices]
        result = scorer.score(stock_data, kline, ['芯片'])
        if result['total'] >= threshold:
            pass_count += 1
    print(f"阈值{threshold}: {pass_count}/10 通过")

print("\n" + "=" * 60)
print("测试完成")
print("=" * 60)
