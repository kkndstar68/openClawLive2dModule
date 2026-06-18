#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_integration.py - 测试多因子选股集成
"""
import sys
sys.path.insert(0, '.')

import FidStock_v2_integration as FidStock_v2

print("=" * 50)
print("测试多因子选股集成")
print("=" * 50)

try:
    stocks = FidStock_v2.scan_stocks_multifactor(batch_size=10, max_stocks=50)
    print(f"\n返回 {len(stocks)} 只股票")
    
    if stocks:
        print("\n前5只股票:")
        for i, s in enumerate(stocks[:5]):
            name = s.get('name', s.get('名称', ''))
            score = s.get('score', s.get('评分', 0))
            print(f"  {i+1}. {name} - {score}分")
    else:
        print("\n未选出股票，检查评分阈值")
        
except Exception as e:
    print(f"\n错误: {e}")
    import traceback
    traceback.print_exc()
