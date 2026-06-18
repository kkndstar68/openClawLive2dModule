import urllib.request
import re

# 测试多只股票验证字段51, 52, 53
codes = ['sh600192', 'sh600036', 'sz000858', 'sh601318']
url = f"http://qt.gtimg.cn/q={','.join(codes)}"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
resp = urllib.request.urlopen(req)
text = resp.read().decode('gbk')

print("验证均线字段 (51=MA5, 52=MA10, 53=MA20):")
for m in re.finditer(r'v_(s[hz]\d{6})="(.+?)";', text):
    code = m.group(1)
    parts = m.group(2).split('~')
    close = float(parts[3]) if parts[3] else 0
    
    ma5 = float(parts[51]) if len(parts) > 51 and parts[51] else 0
    ma10 = float(parts[52]) if len(parts) > 52 and parts[52] else 0
    ma20 = float(parts[53]) if len(parts) > 53 and parts[53] else 0
    
    # 检查合理性
    ma5_ok = 0.5 <= ma5/close <= 1.5 if close > 0 else False
    ma10_ok = 0.5 <= ma10/close <= 1.5 if close > 0 else False
    ma20_ok = 0.5 <= ma20/close <= 1.5 if close > 0 else False
    
    print(f"\n{code}: 现价={close:.2f}")
    print(f"  字段51(MA5)={ma5:.2f} {'✅' if ma5_ok else '❌'}")
    print(f"  字段52(MA10)={ma10:.2f} {'✅' if ma10_ok else '❌'}")
    print(f"  字段53(MA20)={ma20:.2f} {'✅' if ma20_ok else '❌'}")
