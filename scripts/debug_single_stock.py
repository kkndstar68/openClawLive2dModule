import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

from analyzers import StockAnalyzer
from factors import CompositeScorer
import FidStock_v2_integration as FidStock_v2

print("=" * 60)
print("单只股票评分调试")
print("=" * 60)

analyzer = StockAnalyzer()

# 使用之前成功获取的股票
kline = FidStock_v2.fetch_kline('sh600000', 60)
print(f"K线数据: {len(kline)}条")
if kline:
    print(f"最新价: {kline[-1]['close']}")

# 测试不同行业和PE组合
test_cases = [
    {'行业': '银行', 'PE': 6, '年增长率': 5, '量比': 1.2, '换手率': 1},
    {'行业': '科技', 'PE': 30, '年增长率': 30, '量比': 1.5, '换手率': 3},
    {'行业': '新能源', 'PE': 45, '年增长率': 50, '量比': 2.0, '换手率': 5},
    {'行业': '芯片', 'PE': 80, '年增长率': 20, '量比': 1.8, '换手率': 4},
]

for i, stock_data in enumerate(test_cases):
    stock_data['code'] = '600000'
    stock_data['name'] = '测试股票'
    
    result = analyzer.analyze(stock_data, kline, ['芯片', '半导体'])
    
    print(f"\n{i+1}. 行业={stock_data['行业']}, PE={stock_data['PE']}, 增长率={stock_data['年增长率']}%")
    print(f"  总评分: {result.get('score'):.1f}")
    print(f"  通过筛选: {result.get('pass')}")
    
    if result.get('score_detail'):
        detail = result['score_detail']
        print(f"  因子详情:")
        print(f"    趋势: {detail['trend'].get('total', 0)}/35 -> {detail['trend']}")
        print(f"    成交量: {detail['volume'].get('total', 0)}/30")
        print(f"    RSI: {detail['rsi'].get('total', 0)}/10 (RSI值: {detail['rsi'].get('rsi', 0)})")
        print(f"    估值: {detail['valuation'].get('total', 0)}/20")
        print(f"    热点: {detail['hotspot'].get('total', 0)}/10")

print("\n" + "=" * 60)
print("调试完成")
print("=" * 60)
