import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

from FidStock import fetch_kline
from analyzers import ETFAnalyzer

kline = fetch_kline('sh512380', 60)
print('K线数据:', len(kline), '条')

if len(kline) >= 20:
    analyzer = ETFAnalyzer()
    etf_info = {'code': 'sh512380', 'name': '芯片ETF', 'category': '芯片'}
    result = analyzer.analyze(etf_info, kline)
    print('评分:', result.get('score', 0))
    print('结果:', result)
else:
    print('数据不足')
