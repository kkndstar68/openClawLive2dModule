#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
factors.py — 多因子评分引擎
包含所有技术因子的计算逻辑
"""
import numpy as np
from typing import Dict, List, Tuple

class TrendFactor:
    """趋势因子：均线排列 + 价格位置 + MACD"""
    
    @staticmethod
    def calculate(kline_data: List[Dict]) -> Dict[str, float]:
        """
        计算趋势因子
        返回: {'arrangement': 0-15, 'price_position': 0-10, 'macd': 0-10, 'total': 0-35}
        """
        if len(kline_data) < 20:
            return {'arrangement': 0, 'price_position': 0, 'macd': 0, 'total': 0}
        
        closes = np.array([k['close'] for k in kline_data[-60:]])
        
        # 动态计算可用均线
        has_60 = len(closes) >= 60
        ma5 = np.mean(closes[-5:]) if len(closes) >= 5 else closes[-1]
        ma10 = np.mean(closes[-10:]) if len(closes) >= 10 else closes[-1]
        ma20 = np.mean(closes[-20:]) if len(closes) >= 20 else closes[-1]
        current_price = closes[-1]
        
        # 1. 均线排列评分 (0-15)
        arrangement_score = 0
        if has_60:
            ma60 = np.mean(closes[-60:])
            if ma5 > ma10 > ma20 > ma60:
                arrangement_score = 15
            elif ma5 > ma10 > ma20:
                arrangement_score = 12
            elif ma5 > ma10:
                arrangement_score = 8
            elif ma5 > ma20:
                arrangement_score = 5
        else:
            # 无60日线时，退级评价
            if ma5 > ma10 > ma20:
                arrangement_score = 12
            elif ma5 > ma10:
                arrangement_score = 8
            elif ma5 > ma20:
                arrangement_score = 5
        
        # 2. 价格位置评分 (0-10)
        # 价格相对于均线的位置（越在上方越好，但不能超买）
        price_above_ma20 = (current_price - ma20) / ma20 if ma20 > 0 else 0
        if 0.02 < price_above_ma20 < 0.10:  # 在MA20上方2-10%
            position_score = 10
        elif 0 < price_above_ma20 <= 0.02:
            position_score = 8
        elif 0.10 <= price_above_ma20 <= 0.20:
            position_score = 6
        elif price_above_ma20 > 0.20:
            position_score = 2   # 超买风险
        else:
            position_score = 3   # 在MA20下方
        
        # 3. MACD评分 (0-10)
        macd_score = TrendFactor._calculate_macd(closes)
        
        total = arrangement_score + position_score + macd_score
        
        return {
            'arrangement': arrangement_score,
            'price_position': position_score,
            'macd': macd_score,
            'total': total
        }
    
    @staticmethod
    def _calculate_macd(closes: np.ndarray) -> float:
        """计算MACD指标"""
        if len(closes) < 26:
            return 5
        
        ema12 = TrendFactor._ema(closes, 12)
        ema26 = TrendFactor._ema(closes, 26)
        macd_line = ema12 - ema26
        signal_line = TrendFactor._ema(macd_line, 9)
        
        if macd_line[-1] > signal_line[-1] and macd_line[-1] > 0:
            return 10  # 强势
        elif macd_line[-1] > signal_line[-1]:
            return 7   # 温和向上
        else:
            return 3
    
    @staticmethod
    def _ema(closes: np.ndarray, period: int) -> np.ndarray:
        """计算EMA"""
        alpha = 2 / (period + 1)
        ema = np.zeros(len(closes))
        ema[0] = closes[0]
        for i in range(1, len(closes)):
            ema[i] = alpha * closes[i] + (1 - alpha) * ema[i-1]
        return ema


class VolumeFactor:
    """成交量因子：量比 + 换手 + 成交量同比"""
    
    @staticmethod
    def calculate(stock_data: Dict, kline_data: List[Dict]) -> Dict[str, float]:
        """
        计算成交量因子
        返回: {'volume_ratio': 0-10, 'turnover': 0-10, 'vol_ma_ratio': 0-10, 'total': 0-30}
        """
        scores = {}
        
        # 自动兼容小数表示的换手率（如0.035→3.5%）
        turnover = stock_data.get('换手率', 0)
        if 0 < turnover < 1.0:
            turnover *= 100
        
        # 1. 量比 (0-10)
        volume_ratio = stock_data.get('量比', 1.0)
        if volume_ratio > 1.5:
            scores['volume_ratio'] = 10
        elif volume_ratio > 1.2:
            scores['volume_ratio'] = 8
        elif volume_ratio > 0.8:
            scores['volume_ratio'] = 5
        else:
            scores['volume_ratio'] = 2
        
        # 2. 换手率 (0-10)
        # 理想换手率 2-8%，太高太低都不好
        turnover = stock_data.get('换手率', 0)
        if 2 <= turnover <= 5:
            scores['turnover'] = 10
        elif 1 <= turnover < 2 or 5 < turnover <= 8:
            scores['turnover'] = 8
        elif 0.5 <= turnover < 1 or 8 < turnover <= 10:
            scores['turnover'] = 5
        else:
            scores['turnover'] = 2
        
        # 3. 成交量对比MA20 (0-10)
        if len(kline_data) >= 20:
            volumes = [k.get('vol', 0) for k in kline_data[-20:]]
            ma20_vol = np.mean(volumes)
            current_vol = volumes[-1]
            vol_ratio = current_vol / ma20_vol if ma20_vol > 0 else 1
            
            if vol_ratio > 1.5:
                scores['vol_ma_ratio'] = 10
            elif vol_ratio > 1.2:
                scores['vol_ma_ratio'] = 8
            elif vol_ratio > 0.8:
                scores['vol_ma_ratio'] = 5
            else:
                scores['vol_ma_ratio'] = 2
        else:
            scores['vol_ma_ratio'] = 5
        
        scores['total'] = sum(scores.values())
        return scores


class RSIFactor:
    """强弱指数因子：RSI(14)"""
    
    @staticmethod
    def calculate(kline_data: List[Dict]) -> Dict[str, float]:
        """
        计算RSI因子
        返回: {'rsi': 0-100, 'signal': 0-10, 'total': 0-10}
        """
        if len(kline_data) < 14:
            return {'rsi': 50, 'signal': 5, 'total': 5}
        
        rsi = RSIFactor._calculate_rsi(kline_data, 14)
        
        # RSI信号评分
        if 50 < rsi < 70:
            signal_score = 10
        elif 70 <= rsi <= 85:
            signal_score = 6   # 超买但仍强势
        elif rsi > 85:
            signal_score = 5   # 极端超买，需谨慎
        elif 40 <= rsi <= 50:
            signal_score = 8
        elif 30 <= rsi < 40:
            signal_score = 7
        elif rsi < 30:
            signal_score = 5
        else:
            signal_score = 5
        
        return {
            'rsi': rsi,
            'signal': signal_score,
            'total': signal_score
        }
    
    @staticmethod
    def _calculate_rsi(kline_data: List[Dict], period: int = 14) -> float:
        """计算RSI指标"""
        closes = [k['close'] for k in kline_data]
        
        if len(closes) < period + 1:
            return 50
        
        deltas = np.diff(closes[-period-1:])
        seed = deltas[:period]
        up = seed[seed >= 0].sum() / period
        down = -seed[seed < 0].sum() / period
        
        if down == 0:
            # 全涨(up>0)则RSI=100，不涨不跌(up=0)则RSI=50(中性)
            rsi = 100.0 if up > 0 else 50.0
        else:
            rs = up / down
            rsi = 100 - 100 / (1 + rs)
        
        return rsi


class ValuationFactor:
    """估值因子：根据股票分类的PE/PEG评分"""
    
    GROWTH_INDUSTRIES = ['软件', '半导体', '新能源', '芯片', '电动汽车', '光伏', '人工智能', '算力']
    STABLE_INDUSTRIES = ['银行', '保险', '地产', '公用事业', '消费']
    
    @staticmethod
    def calculate(stock_data: Dict) -> Dict[str, float]:
        """
        计算估值因子（分类估值）
        返回: {'valuation': 0-10, 'growth': 0-10, 'total': 0-20}
        """
        industry = stock_data.get('行业', '')
        pe = stock_data.get('PE', 999)
        
        # 自动兼容小数表示的增长率（如0.15→15%）
        growth = stock_data.get('年增长率', 0)
        if 0 < growth < 1.0:
            growth *= 100
        
        # 股票分类
        is_growth_stock = any(keyword in industry for keyword in ValuationFactor.GROWTH_INDUSTRIES)
        
        scores = {}
        
        # 1. PE估值评分
        if is_growth_stock:
            # 成长股：PE < 50
            if pe < 30:
                scores['valuation'] = 10
            elif pe < 50:
                scores['valuation'] = 8
            elif pe < 80:
                scores['valuation'] = 5
            else:
                scores['valuation'] = 2
        else:
            # 稳定股：PE < 25
            if pe < 15:
                scores['valuation'] = 10
            elif pe < 25:
                scores['valuation'] = 8
            elif pe < 35:
                scores['valuation'] = 5
            else:
                scores['valuation'] = 2
        
        # 2. 成长性评分
        if growth > 30:
            scores['growth'] = 10
        elif growth > 20:
            scores['growth'] = 8
        elif growth > 10:
            scores['growth'] = 6
        elif growth > 0:
            scores['growth'] = 4
        else:
            scores['growth'] = 2
        
        scores['total'] = sum(scores.values())
        return scores


class HotspotFactor:
    """热点因子：板块热度"""
    
    @staticmethod
    def calculate(stock_data: Dict, hot_sectors: List[str]) -> Dict[str, float]:
        """
        计算热点因子
        hot_sectors: 热点板块列表
        返回: {'hotspot': 0-10, 'total': 0-10}
        """
        industry = stock_data.get('行业', '')
        concept = stock_data.get('概念', '')
        
        # 检查是否在热点板块
        is_hot = False
        for sector in hot_sectors:
            if sector in industry or sector in concept:
                is_hot = True
                break
        
        score = 10 if is_hot else 3
        
        return {
            'hotspot': score,
            'total': score
        }


class CompositeScorer:
    """综合评分器：多因子加权求和"""
    
    def __init__(self, config: Dict = None):
        """
        初始化评分器
        config: 因子权重配置
        """
        self.config = config or {
            'trend': 0.35,
            'volume': 0.25,
            'rsi': 0.15,
            'valuation': 0.15,
            'hotspot': 0.10
        }
        
        # 各因子的满分
        self.max_scores = {
            'trend': 35,
            'volume': 30,
            'rsi': 10,
            'valuation': 20,
            'hotspot': 10
        }
    
    def score(self, stock_data: Dict, kline_data: List[Dict], 
              hot_sectors: List[str] = None) -> Dict:
        """
        计算综合分数
        """
        if hot_sectors is None:
            hot_sectors = []
        
        # 计算各因子
        trend_scores = TrendFactor.calculate(kline_data)
        volume_scores = VolumeFactor.calculate(stock_data, kline_data)
        rsi_scores = RSIFactor.calculate(kline_data)
        valuation_scores = ValuationFactor.calculate(stock_data)
        hotspot_scores = HotspotFactor.calculate(stock_data, hot_sectors)
        
        # 提取总分
        factor_scores = {
            'trend': trend_scores.get('total', 0),
            'volume': volume_scores.get('total', 0),
            'rsi': rsi_scores.get('total', 0),
            'valuation': valuation_scores.get('total', 0),
            'hotspot': hotspot_scores.get('total', 0)
        }
        
        # 标准化（除以各因子满分）并加权求和
        normalized_scores = {
            factor: (score / self.max_scores[factor]) * 100
            for factor, score in factor_scores.items()
        }
        
        total_score = sum(
            normalized_scores[factor] * self.config[factor]
            for factor in self.config.keys()
        )
        
        return {
            'detail': {
                'trend': trend_scores,
                'volume': volume_scores,
                'rsi': rsi_scores,
                'valuation': valuation_scores,
                'hotspot': hotspot_scores
            },
            'normalized': normalized_scores,
            'total': min(total_score, 100),  # 限制在100以内
            'pass': total_score >= 60
        }
    
    def adaptive_weights(self, market_context: Dict):
        """根据市场环境动态调整权重"""
        volatility = market_context.get('volatility', 2)
        is_bear = market_context.get('is_bear_market', False)
        sentiment = market_context.get('sentiment', 0)  # -1: 负面, 0: 中性, 1: 正面
        
        if volatility > 1.5:  # 高波动市场（日标准差>1.5%）
            self.config = {
                'trend': 0.40,
                'volume': 0.30,
                'rsi': 0.20,
                'valuation': 0.05,
                'hotspot': 0.05
            }
        elif is_bear:  # 熊市
            self.config = {
                'trend': 0.25,
                'volume': 0.20,
                'rsi': 0.20,
                'valuation': 0.30,
                'hotspot': 0.05
            }
        elif sentiment > 0:  # 牛市情绪好
            self.config = {
                'trend': 0.40,
                'volume': 0.25,
                'rsi': 0.15,
                'valuation': 0.10,
                'hotspot': 0.10
            }
