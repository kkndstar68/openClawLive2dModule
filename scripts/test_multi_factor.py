import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

import numpy as np
from factors import TrendFactor, VolumeFactor, RSIFactor, ValuationFactor, HotspotFactor, CompositeScorer
from analyzers import StockAnalyzer
from multi_factor_scanner import MultiFactorScanner, StockListFetcher
import FidStock_v2_integration as FidStock_v2

print("=" * 60)
print("多因子选股单元测试")
print("=" * 60)

# 准备测试数据
test_stock = {
    'code': '600000',
    '名称': '测试股票',
    '行业': '科技',
    'PE': 25,
    '年增长率': 30,
    '量比': 1.5,
    '换手率': 3
}
test_kline_full = [{'close': i + np.random.uniform(-1, 1), 'vol': 1000000 + i * 1000} for i in range(10, 70)]

# 测试1: 因子计算基础功能
print("\n--- 测试1: 因子计算基础功能 ---")
test_kline = [{'close': i, 'vol': 1000000} for i in range(10, 70)]

trend = TrendFactor.calculate(test_kline)
print(f"TrendFactor: {trend}")

volume = VolumeFactor.calculate({'量比': 1.5, '换手率': 3}, test_kline)
print(f"VolumeFactor: {volume}")

rsi = RSIFactor.calculate(test_kline)
print(f"RSIFactor: {rsi}")

valuation = ValuationFactor.calculate({'行业': '科技', 'PE': 25, '年增长率': 30})
print(f"ValuationFactor: {valuation}")

hotspot = HotspotFactor.calculate({'行业': '芯片'}, ['芯片'])
print(f"HotspotFactor: {hotspot}")

# 测试2: 组合评分器
print("\n--- 测试2: 组合评分器 ---")
scorer = CompositeScorer()
score = scorer.score(test_stock, test_kline_full, ['科技'])
print(f"Composite Score: {score}")

# 测试3: 股票分析器
print("\n--- 测试3: 股票分析器 ---")
analyzer = StockAnalyzer()
result = analyzer.analyze(test_stock, test_kline_full, ['科技'])
print(f"Stock Analyzer Result:")
print(f"  score: {result.get('score')}")
print(f"  pass: {result.get('pass')}")
print(f"  conditions: {result.get('conditions')}")

# 测试4: 股票列表获取
print("\n--- 测试4: 股票列表获取 ---")
try:
    quotes = StockListFetcher.fetch_quotes()
    print(f"StockListFetcher.fetch_quotes() 返回: {len(quotes)} 只股票")
    if quotes:
        print(f"  前5只: {quotes[:5]}")
except Exception as e:
    print(f"StockListFetcher.fetch_quotes() 失败: {e}")

# 测试5: K线数据获取
print("\n--- 测试5: K线数据获取 ---")
try:
    kline = FidStock_v2.fetch_kline('sh600000', 60)
    print(f"FidStock_v2.fetch_kline('sh600000', 60) 返回: {len(kline)} 条K线")
    if kline:
        print(f"  最后一条: {kline[-1]}")
except Exception as e:
    print(f"FidStock_v2.fetch_kline() 失败: {e}")

# 测试6: 完整扫描流程
print("\n--- 测试6: 完整扫描流程 ---")
try:
    scanner = MultiFactorScanner()
    stocks = scanner.scan(batch_size=10, max_stocks=50)
    print(f"MultiFactorScanner.scan() 返回: {len(stocks)} 只股票")
    if stocks:
        print(f"  第一只: {stocks[0]}")
except Exception as e:
    import traceback
    print(f"MultiFactorScanner.scan() 失败: {e}")
    traceback.print_exc()

# 测试7: FidStock_v2集成接口
print("\n--- 测试7: FidStock_v2集成接口 ---")
try:
    stocks = FidStock_v2.scan_stocks_multifactor(batch_size=10, max_stocks=50)
    print(f"FidStock_v2.scan_stocks_multifactor() 返回: {len(stocks)} 只股票")
    if stocks:
        report = FidStock_v2.generate_report(stocks)
        print(f"生成报告成功，推荐股票数: {len(report.get('推荐', []))}")
        for s in report.get('推荐', [])[:3]:
            print(f"  {s.get('名称')} - 评分: {s.get('评分')}")
except Exception as e:
    import traceback
    print(f"FidStock_v2.scan_stocks_multifactor() 失败: {e}")
    traceback.print_exc()

print("\n" + "=" * 60)
print("测试完成")
print("=" * 60)
