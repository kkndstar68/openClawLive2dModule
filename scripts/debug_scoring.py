import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

from analyzers import StockAnalyzer
from factors import CompositeScorer
import FidStock_v2_integration as FidStock_v2
import FidStock

print("=" * 60)
print("真实股票评分调试")
print("=" * 60)

# 获取真实股票列表
codes = FidStock.gen_active_codes()[:10]
print(f"\n获取到 {len(codes)} 只股票代码")
print(f"代码列表: {codes}")

# 获取行情数据
quotes = FidStock.fetch_quotes(codes)
print(f"\n获取到 {len(quotes)} 条行情")

analyzer = StockAnalyzer()

for i, quote in enumerate(quotes[:5]):
    code = quote.get('code', quote.get('代码', ''))
    name = quote.get('name', quote.get('名称', ''))
    
    if len(code) == 6 and code.isdigit():
        code_with_prefix = 'sh' + code if code.startswith('6') else 'sz' + code
    else:
        code_with_prefix = code
    
    try:
        kline = FidStock_v2.fetch_kline(code_with_prefix, 60)
        if not kline or len(kline) < 20:
            print(f"\n{i+1}. {name}({code}): K线数据不足")
            continue
        
        # 准备股票数据（添加缺失字段）
        stock_data = {
            'code': code,
            'name': name,
            '行业': quote.get('行业', ''),
            'PE': quote.get('pe', quote.get('市盈率', 0)),
            '年增长率': quote.get('年增长率', 0),
            '量比': quote.get('volume_ratio', quote.get('量比', 1)),
            '换手率': quote.get('turnover', quote.get('换手率', 0)),
            'price': quote.get('price', quote.get('现价', 0)),
            'market_cap': quote.get('market_cap', quote.get('流通市值亿', 0)),
        }
        
        result = analyzer.analyze(stock_data, kline, ['芯片'])
        
        print(f"\n{i+1}. {name}({code})")
        print(f"  现价: {quote.get('price', quote.get('现价', 0))}")
        print(f"  行业: {stock_data['行业']}")
        print(f"  PE: {stock_data['PE']}")
        print(f"  换手率: {stock_data['换手率']}")
        print(f"  量比: {stock_data['量比']}")
        print(f"  总评分: {result.get('score'):.1f}")
        print(f"  通过: {result.get('pass')}")
        
        if result.get('score_detail'):
            detail = result['score_detail']
            print(f"  因子详情:")
            print(f"    趋势: {detail['trend'].get('total', 0)}/35")
            print(f"    成交量: {detail['volume'].get('total', 0)}/30")
            print(f"    RSI: {detail['rsi'].get('total', 0)}/10")
            print(f"    估值: {detail['valuation'].get('total', 0)}/20")
            print(f"    热点: {detail['hotspot'].get('total', 0)}/10")
            
    except Exception as e:
        print(f"\n{i+1}. {name}({code}): 分析失败 - {e}")

print("\n" + "=" * 60)
print("调试完成")
print("=" * 60)
