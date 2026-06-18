#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyzers.py — 不同资产类型的分析器
将股票和ETF分离，使用不同的分析策略
"""
from typing import Dict, List, Tuple
from factors import CompositeScorer, TrendFactor, VolumeFactor, RSIFactor
import numpy as np


class StockAnalyzer:
    """
    股票分析器
    权重: 基本面(50%) + 技术面(30%) + 热点(20%)
    """
    
    def __init__(self, scorer_config: Dict = None):
        self.scorer = CompositeScorer(scorer_config or {
            'trend': 0.30,        # 技术面
            'volume': 0.25,       # 成交量
            'rsi': 0.15,          # 强弱
            'valuation': 0.20,    # 基本面（提高权重）
            'hotspot': 0.10       # 热点
        })
    
    def analyze(self, stock_data: Dict, kline_data: List[Dict], 
                hot_sectors: List[str] = None) -> Dict:
        """
        分析单只股票
        """
        if not kline_data or len(kline_data) < 5:
            return {'error': '数据不足', 'score': 0, 'pass': False}
        
        # 多因子评分
        score_result = self.scorer.score(stock_data, kline_data, hot_sectors or [])
        
        # 计算买点和止损
        buy_points = self._calculate_buy_points(kline_data)
        stop_loss, take_profit = self._calculate_stops(kline_data)
        
        # 计算EV（期望值）
        ev = self._calculate_ev(score_result['total'], stock_data.get('换手率', 0))
        
        return {
            'code': stock_data.get('code'),
            'name': stock_data.get('name'),
            'current_price': kline_data[-1]['close'],
            'score': score_result['total'],
            'score_detail': score_result['detail'],
            'pass': score_result['pass'],
            'buy_point_1': buy_points[0],
            'buy_point_2': buy_points[1],
            'stop_loss': stop_loss,
            'take_profit': take_profit,
            'ev': ev,
            'strategy': self._get_strategy_name(score_result['detail'])
        }
    
    @staticmethod
    def _calculate_buy_points(kline_data: List[Dict]) -> Tuple[float, float]:
        """
        计算两个买点
        买点1: MA20支撑位
        买点2: MA60支撑位
        """
        closes = np.array([k['close'] for k in kline_data[-60:]])
        
        ma20 = np.mean(closes[-20:]) if len(closes) >= 20 else closes[-1]
        ma60 = np.mean(closes[-60:]) if len(closes) >= 60 else closes[-1]
        
        # 买点1在MA20 + 1%
        buy_point_1 = round(ma20 * 1.01, 2)
        # 买点2在MA60 - 2%
        buy_point_2 = round(ma60 * 0.98, 2)
        
        return (buy_point_1, buy_point_2)
    
    @staticmethod
    def _calculate_stops(kline_data: List[Dict]) -> Tuple[float, float]:
        """
        计算止损和止盈
        """
        closes = np.array([k['close'] for k in kline_data[-20:]])
        current_price = closes[-1]
        
        # 20日高低点
        low_20 = np.min(closes)
        
        # 止损：20日低点 - 2%
        stop_loss = round(low_20 * 0.98, 2)
        
        # 止盈：当前价 + (当前价 - 止损) * 2
        take_profit = round(current_price + (current_price - stop_loss) * 2, 2)
        
        return (stop_loss, take_profit)
    
    @staticmethod
    def _calculate_ev(score: float, turnover: float) -> float:
        """
        计算EV（期望值）
        """
        # 评分贡献：60分以上有正期望
        score_contribution = (score - 50) / 10
        
        # 换手率贡献：2-5%最优
        if 2 <= turnover <= 5:
            turnover_contribution = 2
        elif 1 <= turnover < 2 or 5 < turnover <= 8:
            turnover_contribution = 1
        else:
            turnover_contribution = 0
        
        ev = (score_contribution + turnover_contribution) / 2
        return round(max(ev, 0), 2)
    
    @staticmethod
    def _get_strategy_name(score_detail: Dict) -> str:
        """
        根据评分细节推断策略名称
        """
        trend_score = score_detail.get('trend', {}).get('total', 0)
        valuation_score = score_detail.get('valuation', {}).get('total', 0)
        volume_score = score_detail.get('volume', {}).get('total', 0)
        
        if trend_score >= 25 and valuation_score >= 15:
            return "趋势+估值"
        elif trend_score >= 25:
            return "趋势追踪"
        elif valuation_score >= 15:
            return "低估值布局"
        elif volume_score >= 20:
            return "量能突破"
        else:
            return "综合选择"


class ETFAnalyzer:
    """
    ETF分析器
    权重: 技术面(100%)
    """
    
    LIQUID_ETFS = {
        '科技': ['512380', '512710', '512690', '159645'],
        '新能源': ['159601', '159637'],
        '黄金': ['518880', '159934'],
        '稀土': ['159800', '560000'],
        '电力': ['515220', '570018'],
        '半导体': ['512480', '159648'],
    }
    
    # 兼容配置项：若您的 K 线 vol 字段单位为“手”而非“股”（常见于国内部分接口），保持 True 即可在计算成交额时自动乘以 100
    VOL_IN_HANDS = True
    
    def __init__(self):
        self.scorer = CompositeScorer({
            'trend': 0.40,      # 技术面权重最高
            'volume': 0.30,     # 流动性
            'rsi': 0.30,        # 强弱
            'valuation': 0,     # ETF不用估值
            'hotspot': 0        # ETF不用热点
        })
    
    def analyze(self, etf_data: Dict, kline_data: List[Dict]) -> Dict:
        """
        分析ETF
        """
        if not kline_data or len(kline_data) < 20:
            return {'error': '数据不足', 'score': 0, 'pass': False}
        
        # 修正：直接通过 self.scorer 计算，确保全因子计算架构的连贯
        full_etf_data = {
            '量比': etf_data.get('量比', 1.0),
            '换手率': etf_data.get('换手率', 2.0),
            '行业': etf_data.get('category', ''),
            'PE': 999,
            '年增长率': 0
        }
        
        score_result = self.scorer.score(full_etf_data, kline_data)
        total_score = score_result['total']
        
        # 流动性检查（日均成交额 > 3000万）
        current_vol = kline_data[-1].get('vol', 0)
        current_price = kline_data[-1].get('close', 0)
        
        volume_multiplier = 100 if self.VOL_IN_HANDS else 1
        daily_turnover = (current_vol * volume_multiplier) * current_price / 100000000  # 转换成亿元
        
        is_liquid = daily_turnover > 0.3  # 至少3000万
        
        return {
            'code': etf_data.get('code'),
            'name': etf_data.get('name'),
            'category': etf_data.get('category'),
            'current_price': current_price,
            'daily_turnover': round(daily_turnover, 2),
            'score': min(total_score, 100),
            'is_liquid': is_liquid,
            'pass': total_score >= 50 and is_liquid,
            'trend': score_result['detail']['trend'].get('total', 0),
            'rsi': score_result['detail']['rsi']['rsi'],
            'signal': self._get_etf_signal(score_result['detail']['trend'], score_result['detail']['rsi'])
        }
    
    @staticmethod
    def _get_etf_signal(trend_scores: Dict, rsi_scores: Dict) -> str:
        """
        生成交易信号
        """
        trend = trend_scores.get('total', 0)
        rsi = rsi_scores.get('rsi', 50)
        
        if trend >= 25 and 50 <= rsi < 70:
            return "强势，可布局"
        elif trend >= 20:
            return "上升趋势，观察"
        elif rsi <= 30:
            return "超卖，反弹机会"
        else:
            return "平衡"


class MarketContextAnalyzer:
    """
    市场环境分析器
    """
    
    @staticmethod
    def analyze(index_data: List[Dict]) -> Dict:
        """
        分析市场大环境
        """
        if not index_data or len(index_data) < 20:
            return {
                'volatility': 2,
                'is_bear_market': False,
                'sentiment': 0,
                'ma_trend': 'neutral'
            }
        
        closes = np.array([k['close'] for k in index_data[-60:]])
        
        # 1. 波动率 (0-5)
        returns = np.diff(closes) / closes[:-1]
        volatility = float(np.std(returns) * 100)  # 转换为百分比（通常日回报标准差在 0.5% 到 2.5%）
        
        # 修正：将归一化系数从 10 降低到 2。
        # 这样日收益率标准差为 1.5% 时，得分约为 3.0；当标准差 >= 2.5% 时得分封顶为 5。更符合常态分布
        volatility_score = min(volatility * 2.0, 5)  
        
        # 2. 熊牛判断
        ma20 = np.mean(closes[-20:])
        ma60 = np.mean(closes[-60:])
        current_price = closes[-1]
        
        is_bear = current_price < ma60
        ma_trend = 'downtrend' if is_bear else 'uptrend'
        
        # 3. 情绪判断
        recent_5d_return = (closes[-1] - closes[-5]) / closes[-5]
        if recent_5d_return > 0.02:
            sentiment = 1
        elif recent_5d_return < -0.02:
            sentiment = -1
        else:
            sentiment = 0
        
        return {
            'volatility': volatility_score,
            'is_bear_market': is_bear,
            'ma_trend': ma_trend,
            'sentiment': sentiment,
            'current_price': current_price,
            'ma20': ma20,
            'ma60': ma60
        }


class PortfolioAnalyzer:
    """
    组合分析器
    同时分析股票池和ETF池，给出综合建议
    """
    
    def __init__(self):
        self.stock_analyzer = StockAnalyzer()
        self.etf_analyzer = ETFAnalyzer()
    
    def analyze_portfolio(self, 
                         stocks: List[Dict],
                         etfs: List[Dict],
                         market_context: Dict = None) -> Dict:
        """
        分析投资组合
        """
        # 修正：将权重自适应调整置于分析循环之前，确保最新的权重能够立即应用于当前批次的数据评估
        if market_context:
            self.stock_analyzer.scorer.adaptive_weights(market_context)
            
        # 分析股票
        stock_results = []
        for stock in stocks:
            if 'kline_data' in stock:
                result = self.stock_analyzer.analyze(
                    stock,
                    stock['kline_data'],
                    stock.get('hot_sectors', [])
                )
                stock_results.append(result)
        
        # 分析ETF
        etf_results = []
        for etf in etfs:
            if 'kline_data' in etf:
                result = self.etf_analyzer.analyze(etf, etf['kline_data'])
                etf_results.append(result)
        
        # 排序和筛选
        stock_results = sorted(
            [r for r in stock_results if r.get('pass')],
            key=lambda x: x['score'],
            reverse=True
        )[:20]
        
        etf_results = sorted(
            [r for r in etf_results if r.get('pass')],
            key=lambda x: x['score'],
            reverse=True
        )[:10]
        
        return {
            'stocks': stock_results,
            'etfs': etf_results,
            'market_context': market_context or {},
            'total_candidates': len(stock_results),
            'top_stock': stock_results[0] if stock_results else None,
            'top_etf': etf_results[0] if etf_results else None
        }