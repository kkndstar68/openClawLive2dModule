#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""测试数据库连接"""
import sqlite3
import os
import sys

print(f"Python版本: {sys.version}")
print(f"当前工作目录: {os.getcwd()}")

# 测试路径
paths = [
    r'C:\Users\黄云翔\trading\trading.db',
    'C:/Users/黄云翔/trading/trading.db',
    'trading.db',
]

for path in paths:
    abs_path = os.path.abspath(path)
    exists = os.path.exists(path)
    print(f"\n路径: {path}")
    print(f"绝对路径: {abs_path}")
    print(f"文件存在: {exists}")
    
    if exists:
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM holdings")
            count = cur.fetchone()[0]
            conn.close()
            print(f"✅ 连接成功，持仓数量: {count}")
        except Exception as e:
            print(f"❌ 连接失败: {type(e).__name__}: {e}")