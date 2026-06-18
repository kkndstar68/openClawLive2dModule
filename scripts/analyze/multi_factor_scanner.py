#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
multi_factor_scanner.py — 多因子选股主引擎
集成热点板块、ETF、技术分析、多因子评分
"""
import json
import time
import numpy as np
from typing import List, Dict, Tuple
from datetime import datetime
from analyzers import StockAnalyzer, ETFAnalyzer, MarketContextAnalyzer, PortfolioAnalyzer


class HotSectorFetcher:
    """
    热点板块获取器
    从资金流向数据获取当日热点板块
    """
    
    @staticmethod
    def fetch_hot_sectors(top_n: int = 5) -> List[str]:
        """
        获取当日热点板块
        返回: ['芯片', '新能源', '光伏', ...]
        
        实际使用时需要连接到东方财富API：
        http://push2.eastmoney.com/api/qt/clist/get?fsmvCode=0&pagesize=500&sortTypes=5&sortFields=pchg&pageIndex=1
        """
        # TODO: 接入真实API获取热点板块
        # 这里先返回硬编码的热点板块列表
        hot_sectors = [
            '芯片', '半导体', '新能源', '光伏',
            '电力', '算力', '机器人', '人工智能',
            '消费电子', '汽车'
        ]
        return hot_sectors[:top_n]


class StockListFetcher:
    """
    获取特定板块的股票列表
    """
    
    @staticmethod
    def fetch_stocks_by_sector(sector: str, limit: int = 50) -> List[Dict]:
        """
        获取特定板块的股票
        """
        try:
            from FidStock import gen_active_codes
            codes = gen_active_codes()
            result = []
            for code in codes[:limit]:
                # 提取纯数字代码
                pure_code = code.replace('sh', '').replace('sz', '')
                if len(pure_code) == 6 and pure_code.isdigit():
                    result.append({'code': pure_code, 'name': f'{sector}_{pure_code}'})
            return result
        except Exception as e:
            log(f"[警告] 获取板块股票失败: {e}")
            return []
    
    @staticmethod
    def fetch_all_active_stocks(limit: int = 500) -> List[Dict]:
        """
        获取所有活跃股票
        """
        try:
            from FidStock import gen_active_codes
            codes = gen_active_codes()
            result = []
            for code in codes[:limit]:
                # 提取纯数字代码
                pure_code = code.replace('sh', '').replace('sz', '')
                if len(pure_code) == 6 and pure_code.isdigit():
                    result.append({'code': pure_code, 'name': f'股票{pure_code}'})
            return result
        except Exception as e:
            log(f"[警告] 获取活跃股票失败: {e}")
            return []


class MultiFactorScanner:
    """
    多因子扫描器
    主要流程：
    1. 获取热点板块
    2. 获取板块内股票列表
    3. 多因子评分
    4. 同步分析ETF
    5. 整合报告
    """
    
    def __init__(self, config: Dict = None):
        self.config = config or self._default_config()
        self.stock_analyzer = StockAnalyzer()
        self.etf_analyzer = ETFAnalyzer()
        self.portfolio_analyzer = PortfolioAnalyzer()
        self.market_analyzer = MarketContextAnalyzer()
    
    @staticmethod
    def _default_config() -> Dict:
        return {
            'min_score': 60,
            'max_results': 20,
            'max_etf_results': 10,
            'exclude_st': True,
            'exclude_suspended': True,
            'min_price': 3,
            'min_market_cap': 10,  # 亿元
            'focus_hot_sectors': True,
            'hot_sectors_top_n': 5,
            'etf_min_turnover': 30000000,  # 3000万
            'fetch_index_for_market_context': True,
            'max_scan_stocks': 100  # 最大扫描股票数，减少网络请求
        }
    
    def scan(self, 
             fetch_quotes_fn,
             fetch_kline_fn,
             fetch_index_fn=None,
             target_sector: str = None) -> Dict:
        """
        执行多因子扫描
        
        参数:
        - fetch_quotes_fn: 获取行情的函数 (codes) -> [{price, change, ...}]
        - fetch_kline_fn: 获取K线的函数 (code) -> [{open, high, low, close, vol, ...}]
        - fetch_index_fn: 获取指数的函数（用于市场分析）(index_code) -> [{...}]
        - target_sector: 指定扫描的板块，不指定则获取热点
        """
        start_time = time.time()
        log(f"[扫描] 多因子扫描启动 @ {datetime.now().strftime('%H:%M:%S')}")
        
        # 1. 获取市场环境（可选）
        market_context = None
        if self.config['fetch_index_for_market_context'] and fetch_index_fn:
            try:
                index_data = fetch_index_fn('sh000001')  # 上证指数
                market_context = self.market_analyzer.analyze(index_data)
                log(f"[扫描] 市场环境: 波动率={market_context.get('volatility', 0):.1f}, "
                    f"趋势={market_context.get('ma_trend')}, 情绪={market_context.get('sentiment')}")
            except Exception as e:
                log(f"[警告] 获取市场环境失败: {e}")
        
        # 2. 获取热点板块
        if target_sector:
            hot_sectors = [target_sector]
            log(f"[扫描] 指定板块: {target_sector}")
        else:
            hot_sectors = HotSectorFetcher.fetch_hot_sectors(
                self.config['hot_sectors_top_n']
            )
            log(f"[扫描] 获取热点板块: {hot_sectors}")
        
        # 3. 扫描股票
        stock_results = self._scan_stocks(
            hot_sectors,
            fetch_quotes_fn,
            fetch_kline_fn
        )
        log(f"[扫描] 股票扫描完成: {len(stock_results)}只通过筛选")
        
        # 4. 扫描ETF
        etf_results = self._scan_etfs(
            hot_sectors,
            fetch_quotes_fn,
            fetch_kline_fn
        )
        log(f"[扫描] ETF扫描完成: {len(etf_results)}只通过筛选")
        
        # 5. 整合报告
        elapsed = time.time() - start_time
        report = self._generate_report(
            stock_results,
            etf_results,
            market_context,
            elapsed
        )
        
        log(f"[扫描] ✅ 扫描完成! 耗时 {elapsed:.1f}秒")
        
        return report
    
    def _scan_stocks(self, 
                    hot_sectors: List[str],
                    fetch_quotes_fn,
                    fetch_kline_fn) -> List[Dict]:
        """
        扫描股票
        """
        results = []
        total_checked = 0
        total_passed = 0
        codes_to_fetch = []  # 收集需要获取K线的股票
        
        try:
            # 获取热点板块股票列表
            all_codes = set()
            for sector in hot_sectors:
                sector_stocks = StockListFetcher.fetch_stocks_by_sector(sector)
                all_codes.update([s['code'] for s in sector_stocks])
            
            # 如果获取失败，降级为全市场扫描
            if not all_codes:
                log(f"[警告] 无法获取板块股票，进行全市场扫描...")
                all_stocks = StockListFetcher.fetch_all_active_stocks(
                    limit=self.config.get('max_scan_stocks', 500)
                )
                all_codes = [s['code'] for s in all_stocks]
            
            log(f"[扫描] 候选股票数: {len(all_codes)}")
            
            # 分批获取行情 - 添加代码前缀
            batch_size = 50
            for i in range(0, len(all_codes), batch_size):
                batch_codes_raw = list(all_codes)[i:i+batch_size]
                # 为代码添加前缀
                batch_codes = []
                for c in batch_codes_raw:
                    if len(c) == 6 and c.isdigit():
                        batch_codes.append('sh' + c if c.startswith('6') else 'sz' + c)
                    else:
                        batch_codes.append(c)
                
                try:
                    quotes = fetch_quotes_fn(batch_codes)
                except Exception as e:
                    log(f"[警告] 获取行情失败 (batch {i//batch_size}): {e}")
                    continue
                
                for quote in quotes:
                    total_checked += 1
                    
                    # 字段映射 - 兼容中文字段名和英文字段名
                    code = quote.get('code', quote.get('代码', ''))
                    mapped_quote = {
                        'code': code,
                        'name': quote.get('name', quote.get('名称', '')),
                        'price': quote.get('price', quote.get('现价', 0)),
                        'change': quote.get('change', quote.get('涨幅', 0)),
                        'market_cap': quote.get('market_cap', quote.get('流通市值亿', 0)),
                        'turnover': quote.get('turnover', quote.get('换手率', 0)),
                        '换手率': quote.get('turnover', quote.get('换手率', 0)),
                        '量比': quote.get('volume_ratio', quote.get('量比', 0)),
                        'PE': quote.get('pe', quote.get('PE', quote.get('市盈率', 0))),
                        '行业': quote.get('行业', ''),
                        '年增长率': quote.get('growth', quote.get('年增长率', 0)),
                    }
                    
                    # 基本过滤 - 提前过滤减少K线请求
                    if mapped_quote.get('price', 0) < self.config['min_price']:
                        continue
                    if mapped_quote.get('market_cap', 0) < self.config['min_market_cap']:
                        continue
                    if self.config['exclude_st'] and 'ST' in mapped_quote.get('name', ''):
                        continue
                    
                    # 收集需要获取K线的股票
                    kline_code = code
                    if len(code) == 6 and code.isdigit():
                        kline_code = 'sh' + code if code.startswith('6') else 'sz' + code
                    
                    codes_to_fetch.append((mapped_quote, kline_code))
            
            # 多线程并行获取K线数据
            log(f"[扫描] 开始并行获取 {len(codes_to_fetch)} 只股票的K线...")
            start_fetch = time.time()
            
            from concurrent.futures import ThreadPoolExecutor, as_completed
            
            kline_results = {}
            with ThreadPoolExecutor(max_workers=10) as executor:
                future_to_code = {
                    executor.submit(fetch_kline_fn, kline_code): kline_code 
                    for mapped_quote, kline_code in codes_to_fetch
                }
                
                for future in as_completed(future_to_code, timeout=30):
                    kline_code = future_to_code[future]
                    try:
                        kline_data = future.result(timeout=5)
                        if kline_data and len(kline_data) >= 5:
                            kline_results[kline_code] = kline_data
                    except Exception as e:
                        pass  # 忽略单只股票失败
            
            elapsed_fetch = time.time() - start_fetch
            log(f"[扫描] K线获取完成，命中率: {len(kline_results)}/{len(codes_to_fetch)}, 耗时: {elapsed_fetch:.1f}秒")
            
            # 分析获取到K线的股票
            for mapped_quote, kline_code in codes_to_fetch:
                kline_data = kline_results.get(kline_code)
                if not kline_data:
                    continue
                    
                try:
                    analysis = self.stock_analyzer.analyze(
                        mapped_quote,
                        kline_data,
                        hot_sectors
                    )
                    
                    if analysis.get('pass') and analysis.get('score', 0) >= self.config['min_score']:
                        results.append(analysis)
                        total_passed += 1
                        log(f"✅ {mapped_quote.get('code')} {mapped_quote.get('name')}: {analysis['score']:.1f}分")
                except Exception as e:
                    log(f"[警告] 分析失败 ({mapped_quote.get('code')}): {e}")
                    continue
        
        except Exception as e:
            log(f"[错误] 股票扫描失败: {e}")
            import traceback
            log(traceback.format_exc())
        
        # 排序和截断
        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:self.config['max_results']]
        
        return results
    
    def _scan_etfs(self,
                   hot_sectors: List[str],
                   fetch_quotes_fn,
                   fetch_kline_fn) -> List[Dict]:
        """
        扫描ETF
        只扫描流动性强的科技、黄金、稀土ETF
        """
        results = []
        
        # 构建要扫描的ETF列表
        etf_codes_to_scan = []
        for category, codes in ETFAnalyzer.LIQUID_ETFS.items():
            etf_codes_to_scan.extend(codes)
        
        log(f"[ETF扫描] 待扫描ETF数: {len(etf_codes_to_scan)}")
        
        for code in etf_codes_to_scan:
            try:
                # 获取行情
                quotes = fetch_quotes_fn([code])
                if not quotes:
                    continue
                
                quote = quotes[0]
                
                # 获取K线
                kline_data = fetch_kline_fn(code)
                if not kline_data or len(kline_data) < 20:
                    continue
                
                # ETF分类信息（需要从quote中获取）
                etf_info = {
                    'code': code,
                    'name': quote.get('name', f'ETF_{code}'),
                    'category': self._get_etf_category(code),
                    'kline_data': kline_data
                }
                
                # 分析
                analysis = self.etf_analyzer.analyze(etf_info, kline_data)
                
                if analysis.get('pass'):
                    results.append(analysis)
                    log(f"✅ ETF {code} {quote.get('name')}: {analysis['score']:.1f}分")
            
            except Exception as e:
                log(f"[警告] ETF分析失败 ({code}): {e}")
                continue
        
        # 排序和截断
        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:self.config['max_etf_results']]
        
        return results
    
    @staticmethod
    def _get_etf_category(code: str) -> str:
        """获取ETF分类"""
        for category, codes in ETFAnalyzer.LIQUID_ETFS.items():
            if code in codes:
                return category
        return 'other'
    
    def _generate_report(self,
                        stock_results: List[Dict],
                        etf_results: List[Dict],
                        market_context: Dict,
                        elapsed: float) -> Dict:
        """
        生成扫描报告
        """
        return {
            'timestamp': datetime.now().isoformat(),
            'elapsed_seconds': elapsed,
            'market_context': market_context or {},
            'statistics': {
                'total_stocks': len(stock_results),
                'total_etfs': len(etf_results),
                'scan_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            },
            'stocks': stock_results,
            'etfs': etf_results,
            'top_pick': stock_results[0] if stock_results else None,
            'top_etf': etf_results[0] if etf_results else None,
            'recommendations': self._generate_recommendations(stock_results, etf_results)
        }
    
    @staticmethod
    def _generate_recommendations(stocks: List[Dict], etfs: List[Dict]) -> str:
        """
        生成人类可读的建议文本
        """
        if not stocks and not etfs:
            return "暂无推荐，市场机会不足"
        
        recommendations = []
        
        if stocks:
            top_stock = stocks[0]
            recommendations.append(
                f"🔝 股票推荐: {top_stock['name']}({top_stock['code']}) "
                f"评分{top_stock['score']:.1f}分, "
                f"买点{top_stock['buy_point_1']:.2f}元, "
                f"策略{top_stock['strategy']}"
            )
        
        if etfs:
            top_etf = etfs[0]
            recommendations.append(
                f"📊 ETF推荐: {top_etf['name']}({top_etf['code']}) "
                f"评分{top_etf['score']:.1f}分, "
                f"信号{top_etf['signal']}, "
                f"成交额{top_etf['daily_turnover']}亿元"
            )
        
        return ' | '.join(recommendations)


# 日志函数
def log(msg: str):
    """打印带时间戳的日志"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {msg}")


# ============================================================
# 集成示例（供参考）
# ============================================================
def example_usage():
    """
    使用示例
    """
    # 假设从FidStock导入函数
    # from FidStock import fetch_quotes, fetch_kline, gen_active_codes
    
    scanner = MultiFactorScanner()
    
    # 执行扫描
    report = scanner.scan(
        fetch_quotes_fn=lambda codes: [],  # 替换成真实函数
        fetch_kline_fn=lambda code: [],    # 替换成真实函数
        fetch_index_fn=lambda code: [],    # 替换成真实函数
        target_sector=None  # 如果指定则只扫描该板块
    )
    
    # 输出报告
    print(json.dumps(report, ensure_ascii=False, indent=2))
    
    return report


if __name__ == '__main__':
    example_usage()
