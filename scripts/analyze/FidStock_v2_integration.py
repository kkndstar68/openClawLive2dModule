#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FidStock_v2_integration.py — 改进的选股器（多因子版）
保持与原有FidStock的兼容性，同时使用新的多因子系统

集成步骤：
1. 在pet_stock_monitor.py中替换import语句
2. 在handle_alpha()中调用新的scan_stocks_multifactor()
3. 保留原有的generate_report()接口以兼容前端
"""
import sys
import json
import urllib.request
import re
import time
import os
from datetime import datetime
from typing import List, Dict, Tuple

# 尝试导入新的多因子模块
try:
    from factors import CompositeScorer, TrendFactor, VolumeFactor, RSIFactor, ValuationFactor
    from analyzers import StockAnalyzer, ETFAnalyzer, MarketContextAnalyzer
    from multi_factor_scanner import MultiFactorScanner, HotSectorFetcher, log as scanner_log
    HAS_MULTIFACTOR = True
except ImportError:
    HAS_MULTIFACTOR = False
    print("[警告] 无法导入多因子模块，将使用降级方案")

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# ============================================================
# 原有接口保留（与FidStock兼容）
# ============================================================
def gen_active_codes():
    """生成活跃股票代码列表（保留原有实现）"""
    # ... 原有代码 ...
    pass

def fetch_quotes(codes, timeout=12):
    """获取股票行情（保留原有实现）"""
    # ... 原有代码 ...
    pass

def fetch_kline(code, days=60):
    """获取K线数据（保留原有实现）"""
    # ... 原有代码 ...
    pass

# ============================================================
# 新增函数：多因子检查条件
# ============================================================
def check_conditions_multifactor(stock: Dict, kline_data: List[Dict], 
                                 hot_sectors: List[str] = None) -> Dict:
    """
    多因子条件检查（替代旧的check_conditions）
    
    参数:
    - stock: 股票数据 {'code': '600000', 'name': '浦发银行', 'price': 10.5, ...}
    - kline_data: K线数据列表
    - hot_sectors: 热点板块列表
    
    返回:
    - {'总分': 75, 'EV': 2.5, '条件': [...], '买点1': 10.2, '买点2': 9.8, ...}
    """
    if not HAS_MULTIFACTOR:
        # 降级到旧方案
        return check_conditions_legacy(stock)
    
    try:
        # 使用StockAnalyzer进行分析
        analyzer = StockAnalyzer()
        result = analyzer.analyze(
            stock,
            kline_data,
            hot_sectors or []
        )
        
        # 转换为与原有系统兼容的格式
        return {
            '总分': int(result['score']),
            'EV': result['ev'],
            '买点1': result['buy_point_1'],
            '买点2': result['buy_point_2'],
            '止损': result['stop_loss'],
            '止盈': result['take_profit'],
            '策略': result['strategy'],
            '条件': [
                f"趋势评分: {int(result['score_detail']['trend'].get('total', 0))}",
                f"成交量评分: {int(result['score_detail']['volume'].get('total', 0))}",
                f"RSI: {result['score_detail']['rsi'].get('rsi', 50):.0f}",
                f"估值评分: {int(result['score_detail']['valuation'].get('total', 0))}"
            ],
            'pass': result['pass']
        }
    except Exception as e:
        print(f"[错误] 多因子分析失败: {e}")
        # 降级到旧方案
        return check_conditions_legacy(stock)


def check_conditions_legacy(stock: Dict) -> Dict:
    """
    原有的条件检查逻辑（降级方案）
    保持向后兼容性
    """
    # ... 原有check_conditions的实现 ...
    pass


# ============================================================
# 新增函数：多因子扫描
# ============================================================
def scan_stocks_multifactor(batch_size=100, max_stocks=500, 
                           target_sector: str = None) -> List[Dict]:
    """
    多因子扫描（新版本）
    
    参数:
    - batch_size: 批处理大小
    - max_stocks: 最大扫描股票数
    - target_sector: 指定扫描的板块（可选）
    
    返回:
    - 排序后的推荐股票列表
    """
    if not HAS_MULTIFACTOR:
        # 降级到旧方案
        return scan_stocks(batch_size, max_stocks)
    
    print("[多因子扫描] 启动新版本多因子选股器...")
    
    try:
        # 创建扫描器
        scanner = MultiFactorScanner()
        
        # 执行扫描
        report = scanner.scan(
            fetch_quotes_fn=fetch_quotes,
            fetch_kline_fn=fetch_kline,
            fetch_index_fn=None,  # 如果有获取指数的函数可传入
            target_sector=target_sector
        )
        
        # 提取股票结果
        stocks = report.get('stocks', [])
        
        # 转换为与原有系统兼容的格式
        for stock in stocks:
            stock['分析'] = {
                '总分': int(stock['score']),
                'EV': stock['ev'],
                '买点1': stock['buy_point_1'],
                '买点2': stock['buy_point_2'],
                '止损': stock['stop_loss'],
                '止盈': stock['take_profit'],
                '策略': stock['strategy'],
                '条件': [stock['strategy']]
            }
        
        return stocks
    
    except Exception as e:
        print(f"[错误] 多因子扫描失败: {e}")
        import traceback
        print(traceback.format_exc())
        # 降级到旧方案
        return scan_stocks(batch_size, max_stocks)


def scan_stocks(batch_size=100, max_stocks=500):
    """
    原有的扫描函数（保留备用）
    """
    # ... 原有scan_stocks的实现 ...
    pass


# ============================================================
# 保持原有的report生成接口
# ============================================================
def generate_report(stocks: List[Dict]) -> Dict:
    """
    生成报告（保留原有接口以兼容前端）
    """
    report = {
        '推荐': [],
        '统计': {
            '扫描时间': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            '推荐数量': 0
        }
    }
    
    for stock in stocks[:20]:  # 只取前20只
        analysis = stock.get('分析', {})
        
        recommendation = {
            '代码': stock.get('code', ''),
            '名称': stock.get('name', ''),
            '现价': stock.get('current_price', 0),
            '涨幅': stock.get('price_change_pct', 0),
            '评分': analysis.get('总分', 0),
            'EV': analysis.get('EV', 0),
            '买点1': analysis.get('买点1', 0),
            '买点2': analysis.get('买点2', 0),
            '止损': analysis.get('止损', 0),
            '止盈': analysis.get('止盈', 0),
            '策略': analysis.get('策略', '多因子选择'),
            '条件': analysis.get('条件', [])
        }
        
        report['推荐'].append(recommendation)
    
    report['统计']['推荐数量'] = len(report['推荐'])
    
    return report


# ============================================================
# 对外接口：多因子+ETF组合分析
# ============================================================
def scan_stocks_and_etfs(batch_size=100, max_stocks=500,
                         include_etfs=True) -> Dict:
    """
    同时扫描股票和ETF
    
    返回:
    {
        'stocks': [...],
        'etfs': [...],
        'market_context': {...},
        'report': {stock report format}
    }
    """
    if not HAS_MULTIFACTOR:
        return {
            'stocks': scan_stocks(batch_size, max_stocks),
            'etfs': [],
            'report': generate_report(scan_stocks(batch_size, max_stocks))
        }
    
    print("[组合分析] 执行股票+ETF组合分析...")
    
    try:
        scanner = MultiFactorScanner()
        
        # 执行扫描
        scan_result = scanner.scan(
            fetch_quotes_fn=fetch_quotes,
            fetch_kline_fn=fetch_kline,
            fetch_index_fn=None
        )
        
        # 添加分析字段用于兼容
        stocks = scan_result.get('stocks', [])
        for stock in stocks:
            stock['分析'] = {
                '总分': int(stock['score']),
                'EV': stock['ev'],
                '买点1': stock['buy_point_1'],
                '买点2': stock['buy_point_2'],
                '止损': stock['stop_loss'],
                '止盈': stock['take_profit']
            }
        
        return {
            'stocks': stocks,
            'etfs': scan_result.get('etfs', []),
            'market_context': scan_result.get('market_context', {}),
            'report': generate_report(stocks),
            'recommendations': scan_result.get('recommendations', '')
        }
    
    except Exception as e:
        print(f"[错误] 组合分析失败: {e}")
        import traceback
        print(traceback.format_exc())
        return {
            'stocks': scan_stocks(batch_size, max_stocks),
            'etfs': [],
            'report': generate_report(scan_stocks(batch_size, max_stocks))
        }


# ============================================================
# 主函数
# ============================================================
def main():
    """
    主函数：执行多因子扫描
    """
    print(f"[启动] FidStock v2 多因子选股器")
    print(f"[启动] 多因子模块: {'已加载' if HAS_MULTIFACTOR else '未加载（使用降级方案）'}")
    
    # 执行扫描
    stocks = scan_stocks_multifactor(batch_size=200, max_stocks=500)
    
    # 生成报告
    report = generate_report(stocks)
    
    # 打印结果
    print("\n" + "="*60)
    print("🎯 多因子选股结果")
    print("="*60)
    
    for i, stock in enumerate(report['推荐'][:10], 1):
        print(f"\n#{i} {stock['名称']}({stock['代码']})")
        print(f"   现价: {stock['现价']:.2f} | 涨幅: {stock['涨幅']:+.2f}%")
        print(f"   策略: {stock['策略']}")
        print(f"   买点: {stock['买点1']:.2f} / {stock['买点2']:.2f}")
        print(f"   止损: {stock['止损']:.2f} | 止盈: {stock['止盈']:.2f}")
        print(f"   评分: {stock['评分']} | EV: {stock['EV']:+.2f}%")
    
    # 保存报告
    report_path = os.path.join(os.path.dirname(__file__), 'alpha_report_v2.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n📄 报告已保存: {report_path}")


if __name__ == '__main__':
    main()
