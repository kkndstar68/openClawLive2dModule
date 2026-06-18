#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mock_kline.py - K线数据Mock生成器
当真实API不可用时使用此模块生成测试数据
"""
import random
from datetime import datetime, timedelta
from typing import List, Dict


def generate_mock_kline(code: str, days: int = 60) -> List[Dict]:
    """
    生成Mock K线数据
    :param code: 股票代码
    :param days: 天数
    :return: K线数据列表
    """
    kline_data = []
    base_price = random.uniform(5, 50)
    current_date = datetime.now() - timedelta(days=days)
    
    for i in range(days):
        date_str = current_date.strftime('%Y-%m-%d')
        current_date += timedelta(days=1)
        
        if current_date.weekday() >= 5:
            continue
        
        change = random.uniform(-0.05, 0.05)
        open_price = base_price * (1 + random.uniform(-0.02, 0.02))
        close_price = base_price * (1 + change)
        high_price = max(open_price, close_price) * (1 + random.uniform(0, 0.03))
        low_price = min(open_price, close_price) * (1 - random.uniform(0, 0.03))
        volume = int(random.uniform(1000000, 50000000))
        
        kline_data.append({
            'date': date_str,
            'open': round(open_price, 2),
            'close': round(close_price, 2),
            'high': round(high_price, 2),
            'low': round(low_price, 2),
            'volume': volume
        })
        
        base_price = close_price
    
    return kline_data


def generate_mock_quotes(codes: List[str]) -> List[Dict]:
    """
    生成Mock行情数据
    """
    quotes = []
    for code in codes:
        quotes.append({
            'code': code,
            'name': f'股票{code[-4:]}',
            'price': round(random.uniform(5, 50), 2),
            'change': round(random.uniform(-5, 5), 2),
            'turnover': round(random.uniform(1, 8), 2),
            'volume_ratio': round(random.uniform(0.5, 3), 2),
            'pe': round(random.uniform(5, 50), 2),
            '行业': random.choice(['芯片', '半导体', '新能源', '光伏', '电力', '消费']),
            '年增长率': round(random.uniform(-10, 50), 2),
        })
    return quotes
