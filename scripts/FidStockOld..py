#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FidStock.py — Alpha选股器
基于腾讯财经接口和选股条件进行筛选股票
"""
import sys
import json
import urllib.request
import re
import time
import os
import math
from datetime import datetime

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# ============================================================
# 活跃股票池（使用真实股票代码）
# ============================================================
def gen_active_codes():
    """从东方财富获取真实股票代码列表，确保每个代码都能查到行情"""
    all_codes = []
    
    if HAS_REQUESTS:
        # 方案A：使用东方财富接口获取真实代码
        urls = [
            # 上交所：主板+科创板
            "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:13,m:0+t:80&fields=f12",
            # 深交所：主板+创业板+中小板
            "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:1+t:2,m:1+t:23&fields=f12",
        ]
        
        for url in urls:
            try:
                resp = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
                data = resp.json()
                items = data.get('data', {}).get('diff', [])
                for item in items:
                    code = str(item.get('f12', ''))
                    if code:
                        if code.startswith('6'):
                            all_codes.append('sh' + code)
                        elif code.startswith('0') or code.startswith('3'):
                            all_codes.append('sz' + code)
            except:
                continue
        
        all_codes = list(set(all_codes))
        sh_count = len([c for c in all_codes if c.startswith('sh')])
        sz_count = len([c for c in all_codes if c.startswith('sz')])
        print(f"  从东方财富获取: 沪市 {sh_count} 只, 深市 {sz_count} 只, 总计 {len(all_codes)} 只")
    
    # 方案B：备用活跃代码池（当网络不可用时）
    if not all_codes:
        codes = []
        # 沪市主板 - 常用范围
        for i in range(100, 700):
            codes.append(f'sh600{i:03d}')
        for i in range(100, 200):
            codes.append(f'sh601{i:03d}')
        for i in range(100, 700):
            codes.append(f'sh603{i:03d}')
        # 深市主板
        for pfx in ['000', '001', '002']:
            for i in range(100, 800):
                codes.append(f'sz{pfx}{i:03d}')
        # 创业板
        for i in range(100, 600):
            codes.append(f'sz300{i:03d}')
        all_codes = codes
        print(f"  使用备选方案: 生成约 {len(all_codes)} 只候选股票")
    
    return all_codes

# ============================================================
# 腾讯API: 实时行情
# ============================================================
def fetch_quotes(codes, timeout=12):
    url = f"http://qt.gtimg.cn/q={','.join(codes)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode('gbk', errors='replace')
    except Exception as e:
        print(f"[ERR] 获取行情失败: {e}")
        return []
    
    results = []
    for m in re.finditer(r'v_(s[hz]\d{6})="(.+?)";', text):
        parts = m.group(2).split('~')
        if len(parts) < 40:
            continue
        try:
            close = float(parts[3]) if parts[3] else 0
            
            # 提取均线数据
            # 腾讯API: 字段51=MA5, 字段52/53不是有效的MA10/MA20
            ma5 = float(parts[51]) if len(parts) > 51 and parts[51] else 0
            
            # 合理性检查：MA5应该在现价的50%-150%之间
            def valid_ma(ma, price):
                if ma <= 0 or price <= 0:
                    return False
                ratio = ma / price
                return 0.5 <= ratio <= 1.5
            
            ma5 = ma5 if valid_ma(ma5, close) else 0
            
            results.append({
                '代码': parts[2],
                '名称': parts[1],
                '现价': close,
                '昨收': float(parts[4]) if parts[4] else 0,
                '开盘': float(parts[5]) if parts[5] else 0,
                '成交量手': int(float(parts[6])) if parts[6] else 0,
                '成交额万': float(parts[37]) if len(parts) > 37 and parts[37] else 0,
                '涨幅': float(parts[32]) if len(parts) > 32 and parts[32] else 0,
                '最高': float(parts[33]) if len(parts) > 33 and parts[33] else 0,
                '最低': float(parts[34]) if len(parts) > 34 and parts[34] else 0,
                '换手率': float(parts[38]) if len(parts) > 38 and parts[38] else 0,
                '市盈率': float(parts[39]) if len(parts) > 39 and parts[39] else 0,
                '振幅': float(parts[43]) if len(parts) > 43 and parts[43] else 0,
                '流通市值亿': float(parts[44]) if len(parts) > 44 and parts[44] else 0,
                '总市值亿': float(parts[45]) if len(parts) > 45 and parts[45] else 0,
                '量比': float(parts[49]) if len(parts) > 49 and parts[49] else 0,
                '涨停价': float(parts[11]) if len(parts) > 11 and parts[11] else 0,
                '跌停价': float(parts[12]) if len(parts) > 12 and parts[12] else 0,
                '5日均价': ma5,  # 唯一可靠的均线数据（腾讯API字段51）
            })
        except (ValueError, IndexError):
            continue
    return results

# ============================================================
# 腾讯API: K线数据
# ============================================================
def fetch_kline(code, days=60):
    """获取股票K线数据（支持日K、周K、月K）"""
    try:
        import requests
        url = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={code.replace('sh','1.').replace('sz','0.')}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt={days}"
        resp = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        data = resp.json()
        kline_data = []
        if data.get('data', {}).get('klines'):
            for line in data['data']['klines'][:days]:
                items = line.split(',')
                if len(items) >= 6:
                    kline_data.append({
                        'date': items[0],
                        'open': float(items[1]),
                        'close': float(items[2]),
                        'high': float(items[3]),
                        'low': float(items[4]),
                        'volume': int(items[5])
                    })
        return kline_data
    except Exception as e:
        print(f"[ERR] 获取K线失败: {e}")
        return []

# ============================================================
# 选股条件检查（只使用真实数据）
# ============================================================
def check_conditions(stock):
    """检查选股条件 - 只使用真实可用的数据"""
    conditions = []
    scores = []
    
    # 提取真实数据
    ma5 = stock.get('5日均价', 0)  # 腾讯API字段51，这是唯一可靠的均线数据
    close = stock.get('现价', 0)
    prev_close = stock.get('昨收', 0)
    change = stock.get('涨幅', 0)  # 涨幅百分比
    
    # 方案B: 简化趋势判断 - 只使用真实MA5
    has_valid_ma = ma5 > 0 and close > 0
    
    # 基于真实数据的趋势判断
    if has_valid_ma:
        # 真实趋势判断：现价在MA5上方
        price_vs_ma5 = close > ma5
        
        # 上涨强度：今日涨幅 vs MA5作为支撑的强度
        # 如果现价高于MA5且涨幅为正，认为趋势向上
        if price_vs_ma5 and change > 0:
            # 进一步细分
            if change > 5 and close > ma5 * 1.02:
                conditions.append('✅ 强势突破')
                scores.append(15)
            elif change > 2:
                conditions.append('✅ 趋势向上')
                scores.append(12)
            else:
                conditions.append('⚡ 温和上涨')
                scores.append(8)
        elif price_vs_ma5:
            conditions.append('📊 高于均线')
            scores.append(5)
        else:
            conditions.append('📉 低于均线')
            scores.append(-5)
    else:
        # 没有MA5数据时，基于涨幅判断
        if change > 3:
            conditions.append('⚡ 涨幅较大')
            scores.append(8)
        elif change > 0:
            conditions.append('📈 小幅上涨')
            scores.append(3)
        else:
            conditions.append('📉 下跌或横盘')
            scores.append(-5)
    
    # 条件2: 换手率 > 3% 且 < 20%
    turnover = stock.get('换手率', 0)
    if 3 <= turnover <= 20:
        conditions.append('✅ 换手率健康')
        scores.append(10)
    elif turnover < 3:
        conditions.append('😴 交投清淡')
        scores.append(-3)
    else:
        conditions.append('🔥 过度炒作')
        scores.append(-5)
    
    # 条件3: 量比 > 1.2
    volume_ratio = stock.get('量比', 0)
    if volume_ratio > 1.2:
        conditions.append('✅ 放量上涨')
        scores.append(8)
    else:
        conditions.append('📊 量能一般')
        scores.append(0)
    
    # 条件4: 价格强度（相对昨收的强度，与条件1的MA趋势独立）
    # 使用振幅或最高价涨幅作为独立维度
    amplitude = stock.get('振幅', 0)
    if amplitude > 5:
        conditions.append('🌊 波动活跃')
        scores.append(5)
    elif amplitude > 3:
        conditions.append('� 波动适中')
        scores.append(3)
    else:
        conditions.append('� 波动平缓')
        scores.append(0)
    
    # 条件5: 流通市值 < 200亿
    float_cap = stock.get('流通市值亿', 0)
    if float_cap > 0 and float_cap < 200:
        conditions.append('✅ 中小盘')
        scores.append(8)
    elif float_cap >= 200 and float_cap < 500:
        conditions.append('📐 中大盘')
        scores.append(3)
    else:
        conditions.append('🏢 大盘股')
        scores.append(-3)
    
    # 条件6: 市盈率合理
    pe = stock.get('市盈率', 0)
    if 0 < pe < 50:
        conditions.append('✅ 估值合理')
        scores.append(8)
    elif pe >= 50:
        conditions.append('⚠️ 估值偏高')
        scores.append(-5)
    else:
        conditions.append('❓ 市盈率缺失')
        scores.append(0)
    
    # ===== 买点计算逻辑（只使用真实MA5数据） =====
    # 策略：现价高于MA5时，等待回踩MA5买入；现价低于MA5时，等待反弹突破MA5
    
    if has_valid_ma:
        if close > ma5:
            # 现价在MA5上方：回踩MA5买入
            buy_point_1 = round(ma5 * 1.0, 2)
            buy_point_2 = round(ma5 * 0.98, 2)  # MA5下方2%
            stop_loss = round(ma5 * 0.93, 2)     # MA5下方7%止损
            entry_strategy = '回踩MA5买入'
        else:
            # 现价在MA5下方：等待反弹或突破
            buy_point_1 = round(ma5 * 1.0, 2)    # 突破MA5买入
            buy_point_2 = round(close * 0.97, 2) # 回调3%买入
            stop_loss = round(close * 0.93, 2)   # 下跌7%止损
            entry_strategy = '突破MA5买入'
    else:
        # 没有MA5数据：使用现价计算
        buy_point_1 = round(close * 0.97, 2)
        buy_point_2 = round(close * 0.95, 2)
        stop_loss = round(close * 0.93, 2)
        entry_strategy = '回调买入'
    
    # ===== EV计算 =====
    # EV = (目标收益 - 风险损失) / 当前价格 * 60%
    # 目标收益：买入价上涨8%
    target_profit_pct = 0.08
    
    # 期望收益率 = (上涨空间 * 成功率 - 下跌风险 * 失败率) / 当前价
    # 简化：假设成功率 = 总分/100，失败率 = 1-成功率
    success_rate = min(max(sum(scores) / 100, 0.1), 0.9)  # 限制在10%-90%
    fail_rate = 1 - success_rate
    
    expected_profit = buy_point_1 * target_profit_pct * success_rate
    expected_loss = (buy_point_1 - stop_loss) * fail_rate
    ev = round((expected_profit - expected_loss) / close * 60, 2) if close > 0 else 0
    
    return {
        '条件': conditions,
        '总分': sum(scores),
        '买点1': buy_point_1,
        '买点2': buy_point_2,
        '止损': stop_loss,
        '止盈': round(buy_point_1 * 1.08, 2),
        'EV': ev,
        '策略': entry_strategy,
    }

# ============================================================
# 扫描主函数
# ============================================================
def scan_stocks(batch_size=100, max_stocks=500):
    """扫描股票并筛选"""
    print("🚀 Alpha选股器启动...")
    
    # 使用活跃股票池（避免随机抽样导致结果不可复现）
    all_codes = gen_active_codes()
    print(f"📊 候选股票池: {len(all_codes)}")
    print(f"  提示：使用东方财富接口获取的真实股票列表，每只都能查到实时行情")
    
    # 限制扫描数量（按代码顺序）
    sample_codes = all_codes[:max_stocks]
    print(f"� 本次扫描: {len(sample_codes)} 只股票")
    
    results = []
    total_fetched = 0
    fetch_failed = 0
    filter_price = 0
    filter_cap = 0
    start_time = time.time()
    total_requested = 0
    
    # 分批获取行情
    for i in range(0, len(sample_codes), batch_size):
        batch = sample_codes[i:i+batch_size]
        if not batch:
            continue  # 跳过空批次
        total_requested += len(batch)
        print(f"🔄 处理批次 {i//batch_size + 1}, 代码: {batch[:3]}...")
        
        quotes = fetch_quotes(batch)
        batch_fetched = len(quotes)
        total_fetched += batch_fetched
        
        # 统计失败数：请求数 - 实际获取数
        fetch_failed += (len(batch) - batch_fetched)
        
        if batch_fetched == 0:
            continue
        
        for stock in quotes:
            # 基本过滤
            if stock['现价'] < 3:
                filter_price += 1
                continue  # 低价股过滤
            if stock['流通市值亿'] < 10:
                filter_cap += 1
                continue  # 太小市值过滤
            
            # 检查条件（均线无效时使用宽松策略）
            analysis = check_conditions(stock)
            
            stock['分析'] = analysis
            results.append(stock)
            
            print(f"✅ {stock['代码']} {stock['名称']}, 评分: {analysis['总分']}, EV: {analysis['EV']}%")
    
    print(f"\n📊 扫描统计:")
    print(f"   请求批次: {(len(sample_codes) + batch_size - 1)//batch_size}")
    print(f"   获取行情: {total_fetched} 只")
    print(f"   获取失败: {fetch_failed} 只")
    print(f"   价格过滤: {filter_price} 只")
    print(f"   市值过滤: {filter_cap} 只")
    print(f"   最终通过: {len(results)} 只")
    
    # 按总分排序
    results.sort(key=lambda x: x['分析']['总分'], reverse=True)
    
    elapsed = time.time() - start_time
    print(f"✅ 扫描完成! 获取行情 {total_fetched} 只, 通过筛选 {len(results)} 只, 耗时 {elapsed:.1f}秒")
    
    return results[:20]  # 返回前20只

# ============================================================
# 生成报告
# ============================================================
def generate_report(stocks):
    """生成选股报告"""
    report = {
        '时间': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        '扫描总数': len(stocks),
        '推荐': []
    }
    
    for stock in stocks:
        rec = {
            '代码': stock['代码'],
            '名称': stock['名称'],
            '现价': stock['现价'],
            '涨幅': stock['涨幅'],
            '买点1': stock['分析']['买点1'],
            '买点2': stock['分析']['买点2'],
            '止损': stock['分析']['止损'],
            '止盈': stock['分析'].get('止盈', 0),
            '评分': stock['分析']['总分'],
            '条件': stock['分析']['条件'],
            'EV': stock['分析']['EV'],
            '策略': stock['分析'].get('策略', ''),
            '流通市值亿': stock['流通市值亿'],
            '换手率': stock['换手率'],
        }
        report['推荐'].append(rec)
    
    return report

# ============================================================
# 主函数
# ============================================================
def main():
    stocks = scan_stocks(batch_size=200, max_stocks=500)
    report = generate_report(stocks)
    
    # 打印结果
    print("\n" + "="*60)
    print("🎯 Alpha选股结果")
    print("="*60)
    
    for i, stock in enumerate(report['推荐'][:10], 1):
        print(f"\n#{i} {stock['名称']}({stock['代码']})")
        print(f"   现价: {stock['现价']:.2f} | 涨幅: {stock['涨幅']:+.2f}%")
        print(f"   策略: {stock['策略']}")
        print(f"   买点: {stock['买点1']:.2f} / {stock['买点2']:.2f}")
        print(f"   止损: {stock['止损']:.2f} | 止盈: {stock['止盈']:.2f}")
        print(f"   评分: {stock['评分']} | EV: {stock['EV']:+.2f}%")
        print(f"   条件: {', '.join(stock['条件'])}")
    
    # 保存报告
    report_path = os.path.join(os.path.dirname(__file__), 'alpha_report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n📄 报告已保存: {report_path}")

if __name__ == '__main__':
    main()
