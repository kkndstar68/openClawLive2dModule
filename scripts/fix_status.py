#!/usr/bin/env python
# -*- coding: utf-8 -*-
import sqlite3

conn = sqlite3.connect('trading.db')
cur = conn.cursor()

# 更新所有已卖出状态为当前持仓
cur.execute("UPDATE holdings SET status = '当前持仓' WHERE status = '已卖出'")
updated = cur.rowcount
conn.commit()

# 查询当前持仓数量
cur.execute("SELECT COUNT(*) FROM holdings WHERE status = '当前持仓'")
count = cur.fetchone()[0]

print(f"已更新 {updated} 条记录")
print(f"当前持仓总数: {count}")

conn.close()