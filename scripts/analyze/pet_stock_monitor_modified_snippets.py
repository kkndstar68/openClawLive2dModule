#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pet_stock_monitor_modified_snippets.py
这个文件展示了如何修改pet_stock_monitor.py来集成多因子选股系统
注意：这只是关键代码段，需要整合到完整的pet_stock_monitor.py中
"""

# ============================================================
# 修改点1：handle_alpha() 方法（重点！）
# ============================================================

def handle_alpha(self):
    """处理Alpha选股请求 - 已改进为多因子版本"""
    log(f"[API] ===== Alpha选股扫描开始 ======")
    
    try:
        # 【改进】优先使用多因子版本，失败自动降级
        import importlib.util
        import sys
        import os
        
        # 第一步：尝试加载多因子版本
        fidstock_v2_path = os.path.join(os.path.dirname(__file__), 'FidStock_v2_integration.py')
        
        if os.path.exists(fidstock_v2_path):
            try:
                log(f"[API] 正在加载多因子选股器...")
                spec = importlib.util.spec_from_file_location("FidStock_v2", fidstock_v2_path)
                
                if spec is None or spec.loader is None:
                    raise ImportError("无法加载FidStock_v2模块")
                
                FidStock_v2 = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(FidStock_v2)
                
                log(f"[API] ✅ 多因子选股器加载成功")
                
                # 执行多因子扫描
                log(f"[API] 开始多因子扫描...")
                stocks = FidStock_v2.scan_stocks_multifactor(
                    batch_size=50,
                    max_stocks=300
                )
                
                log(f"[API] ✅ 多因子扫描完成，获得 {len(stocks)} 只股票")
                
                # 生成报告
                report = FidStock_v2.generate_report(stocks)
                log(f"[API] ✅ 报告生成完成")
                
                # 推送到WebSocket（增强格式）
                if stocks:
                    try:
                        # 构建增强格式的推送消息
                        top_stock = stocks[0]
                        push_message = {
                            'type': 'alpha',
                            'text': f"🎯 多因子选股: {top_stock.get('name')} {top_stock.get('score'):.0f}分 (评分{int(top_stock.get('score', 0))})",
                            'stocks': stocks[:5],  # 推送前5只
                            'total': len(stocks),
                            'method': 'multifactor'
                        }
                        asyncio.create_task(push_to_pet([push_message]))
                        log(f"[API] ✅ 推送到WebSocket")
                    except Exception as e:
                        log(f"[API] ⚠️ WebSocket推送失败: {e}")
                
                self.send_json(report)
                log(f"[API] ✅ Alpha选股请求成功返回")
                return
                
            except Exception as e:
                log(f"[API] ⚠️ 多因子扫描失败: {type(e).__name__}: {e}")
                import traceback
                log(f"[API] 错误详情:\n{traceback.format_exc()}")
                log(f"[API] 正在降级到旧版本FidStock...")
        
        # 【降级方案】如果多因子版本不可用或失败，使用旧版本
        log(f"[API] 使用旧版本FidStock进行扫描")
        
        fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
        spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
        
        if spec is None or spec.loader is None:
            self.send_json({'error': '无法加载任何选股模块'}, 500)
            return
        
        FidStock = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(FidStock)
        
        stocks = FidStock.scan_stocks(batch_size=50, max_stocks=200)
        log(f"[API] 旧版本扫描完成，获得 {len(stocks)} 只股票")
        
        report = FidStock.generate_report(stocks)
        
        # 推送旧格式消息
        if stocks:
            try:
                push_message = {
                    'type': 'alert',
                    'text': f"📈 选股完成: 推荐 {len(stocks)} 只股票"
                }
                asyncio.create_task(push_to_pet([push_message]))
            except Exception as e:
                log(f"[API] ⚠️ WebSocket推送失败: {e}")
        
        self.send_json(report)
        log(f"[API] ✅ Alpha选股请求成功返回 (使用旧版本)")
        
    except Exception as e:
        log(f"[API] ❌ Alpha选股彻底失败: {type(e).__name__}: {e}")
        import traceback
        log(f"[API] 错误详情:\n{traceback.format_exc()}")
        self.send_json({'error': f'Alpha选股失败: {str(e)}'}, 500)
    
    log(f"[API] ===== Alpha选股扫描结束 ======")


# ============================================================
# 修改点2：新增 handle_etf_analysis() 方法
# ============================================================

def handle_etf_analysis(self):
    """
    处理ETF分析请求
    GET /api/analyze_etf?code=512380
    """
    import re
    
    # 获取查询参数中的ETF代码
    match = re.search(r'code=([sz]?h?\d{6})', self.path)
    if not match:
        self.send_json({'error': '缺少code参数'}, 400)
        return
    
    code = match.group(1)
    
    # 格式化代码
    if len(code) == 6 and code.isdigit():
        if code.startswith('6'):
            code = 'sh' + code
        else:
            code = 'sz' + code
    
    log(f"[API] ETF分析请求: {code}")
    
    try:
        # 尝试使用多因子模块
        from analyzers import ETFAnalyzer
        
        etf_analyzer = ETFAnalyzer()
        
        # 获取K线数据
        import importlib.util
        import os
        
        fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
        spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
        FidStock = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(FidStock)
        
        kline_data = FidStock.fetch_kline(code, days=60)
        
        if not kline_data or len(kline_data) < 20:
            self.send_json({'error': '数据不足'}, 400)
            return
        
        # 分析ETF
        etf_info = {
            'code': code,
            'name': f'ETF_{code}',
            'category': 'unknown'
        }
        
        result = etf_analyzer.analyze(etf_info, kline_data)
        
        log(f"[API] ✅ ETF分析完成: {code}, 评分={result.get('score', 0):.1f}")
        
        self.send_json(result)
        
    except ImportError:
        log(f"[API] ⚠️ 多因子模块不可用，降级处理")
        self.send_json({
            'code': code,
            'error': '多因子模块不可用，无法进行深度分析',
            'message': '请确保factors.py和analyzers.py已正确部署'
        }, 400)
    
    except Exception as e:
        log(f"[API] ❌ ETF分析失败: {type(e).__name__}: {e}")
        import traceback
        log(traceback.format_exc())
        self.send_json({'error': f'ETF分析失败: {str(e)}'}, 500)


# ============================================================
# 修改点3：新增 handle_hot_sectors() 方法
# ============================================================

def handle_hot_sectors(self):
    """
    获取热点板块
    GET /api/hot_sectors
    """
    log(f"[API] 获取热点板块请求")
    
    try:
        # 尝试使用多因子模块
        from multi_factor_scanner import HotSectorFetcher
        
        hot_sectors = HotSectorFetcher.fetch_hot_sectors(top_n=5)
        
        log(f"[API] ✅ 获取热点板块: {hot_sectors}")
        
        self.send_json({
            'success': True,
            'hot_sectors': hot_sectors,
            'count': len(hot_sectors),
            'timestamp': datetime.now().isoformat()
        })
    
    except ImportError:
        log(f"[API] ⚠️ 多因子模块不可用，使用默认热点板块")
        
        # 降级方案：返回默认热点板块
        default_hot_sectors = ['芯片', '新能源', '光伏', '电力', '算力']
        
        self.send_json({
            'success': True,
            'hot_sectors': default_hot_sectors,
            'count': len(default_hot_sectors),
            'is_default': True,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        log(f"[API] ❌ 获取热点板块失败: {e}")
        self.send_json({'error': f'获取热点板块失败: {str(e)}'}, 500)


# ============================================================
# 修改点4：handle_kline() 中新增对ETF的支持
# ============================================================

def handle_kline(self):
    """处理K线数据请求 - 已支持ETF"""
    import re
    
    match = re.search(r'/api/kline/([s]?[hz]?\\d{6})', self.path)
    if not match:
        self.send_json({'error': 'Invalid stock code'}, 400)
        return
    
    code = match.group(1)
    
    # 格式化代码
    if len(code) == 6 and code.isdigit():
        if code.startswith('6'):
            code = 'sh' + code
        else:
            code = 'sz' + code
    
    is_etf = code.startswith('sh') and int(code[2:]) >= 500000  # 简单判断
    log(f"[API] 获取K线数据: {code} ({'ETF' if is_etf else 'Stock'})")
    
    try:
        import importlib.util
        import os
        
        fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
        spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
        FidStock = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(FidStock)
        
        kline_data = FidStock.fetch_kline(code, days=60)
        
        # 如果是ETF且有多因子模块，同时返回ETF分析
        etf_analysis = None
        if is_etf:
            try:
                from analyzers import ETFAnalyzer
                etf_analyzer = ETFAnalyzer()
                etf_info = {'code': code, 'name': f'ETF_{code}', 'category': 'unknown'}
                etf_analysis = etf_analyzer.analyze(etf_info, kline_data)
            except Exception as e:
                log(f"[API] ⚠️ ETF分析失败: {e}")
        
        log(f"[API] ✅ 获取K线数据成功: {len(kline_data)} 条")
        
        response = {'code': code, 'data': kline_data}
        if etf_analysis:
            response['etf_analysis'] = etf_analysis
        
        self.send_json(response)
        
    except Exception as e:
        log(f"[API] ❌ 获取K线失败: {type(e).__name__}: {e}")
        self.send_json({'error': f'获取K线失败: {str(e)}'}, 500)


# ============================================================
# 修改点5：在 StockHandler.do_GET() 中添加新的路由
# ============================================================

def do_GET(self):
    """HTTP GET请求处理"""
    log(f"[HTTP] {self.command} {self.path}")
    
    # 原有路由保留
    if self.path.startswith('/api/kline/'):
        self.handle_kline()
    elif self.path.startswith('/api/alpha'):
        self.handle_alpha()
    
    # 新增路由
    elif self.path.startswith('/api/analyze_etf'):
        self.handle_etf_analysis()
    elif self.path.startswith('/api/hot_sectors'):
        self.handle_hot_sectors()
    
    # 其他处理...
    else:
        self.send_json({'error': 'Not found'}, 404)


# ============================================================
# 修改点6：改进 push_to_pet() 以支持多因子格式
# ============================================================

async def push_to_pet(alerts):
    """
    推送告警到桌宠前端
    已改进为支持多因子选股的增强格式
    """
    try:
        import websockets
        from websockets.client import WebSocketClientProtocol
        
        if not alerts:
            return
        
        async with websockets.connect(WS_URL, ping_interval=20) as websocket:
            for alert in alerts:
                # 兼容旧格式和新格式
                if alert.get('type') == 'alpha' and 'stocks' in alert:
                    # 新格式：多因子选股结果
                    message = {
                        'type': 'stock',
                        'text': alert.get('text', ''),
                        'stocks': alert.get('stocks', [])[:3],  # 只推送前3只
                        'total': alert.get('total', 0),
                        'method': 'multifactor'
                    }
                else:
                    # 旧格式：简单告警
                    message = alert
                
                message_json = json.dumps(message, ensure_ascii=False)
                await websocket.send(message_json)
                log(f"[WebSocket] ✅ 推送成功: {message.get('type')}")
    
    except Exception as e:
        log(f"[WebSocket] ❌ 推送失败: {e}")


# ============================================================
# 注意事项
# ============================================================
"""
1. 这些代码段需要整合到原有的pet_stock_monitor.py中
2. 确保import语句正确，特别是多因子模块的import
3. 保持原有的日志函数log()和异步处理方式
4. handle_alpha()中的优先级很重要：多因子 > 旧版本
5. 所有新增方法都有try-except，确保异常不会导致系统崩溃
6. 如果多因子模块不存在，系统会自动降级到旧版本（向后兼容）
"""
