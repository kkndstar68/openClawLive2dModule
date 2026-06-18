import sys
sys.path.insert(0, 'e:/pet20260303/openClawLive2dModule/scripts')

import re
import os

# 模拟请求路径
self_path = '/api/analyze_etf?code=512380'

# 步骤1: 正则匹配
match = re.search(r'code=(sh|sz)?(\d{6})', self_path)
if not match:
    print('步骤1失败: 缺少code参数')
    sys.exit(1)

prefix = match.group(1) or ''
code_num = match.group(2)
code = prefix + code_num if prefix else ('sh' + code_num if code_num.startswith('6') else 'sz' + code_num)
print(f'步骤1通过: code={code}')

# 步骤2: 加载分析器
try:
    from analyzers import ETFAnalyzer
    etf_analyzer = ETFAnalyzer()
    print('步骤2通过: ETFAnalyzer加载成功')
except Exception as e:
    print(f'步骤2失败: {e}')
    sys.exit(1)

# 步骤3: 获取K线数据
try:
    import importlib.util
    fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
    spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
    FidStock = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(FidStock)
    
    kline_data = FidStock.fetch_kline(code, days=60)
    print(f'步骤3通过: K线数据 {len(kline_data)} 条')
except Exception as e:
    print(f'步骤3失败: {e}')
    sys.exit(1)

# 步骤4: 检查数据量
if not kline_data or len(kline_data) < 20:
    print(f'步骤4失败: 数据不足, 仅{len(kline_data)}条')
    sys.exit(1)
print('步骤4通过: 数据量足够')

# 步骤5: 分析ETF
try:
    etf_info = {'code': code, 'name': f'ETF_{code}', 'category': 'unknown'}
    result = etf_analyzer.analyze(etf_info, kline_data)
    print(f'步骤5通过: 评分={result.get("score", 0):.1f}')
    print('完整结果:', result)
except Exception as e:
    print(f'步骤5失败: {type(e).__name__}: {e}')
    import traceback
    traceback.print_exc()
    sys.exit(1)

print('全部通过!')
