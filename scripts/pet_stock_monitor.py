"""
pet_stock_monitor.py — 桌宠股票监控服务
💰 持仓监控 + 📋 选股池监控
支持持续轮询、实时推送、完整告警规则、HTTP API

启动命令:
D:\python34\python.exe e:\pet20260303\openClawLive2dModule\scripts\pet_stock_monitor.py

配置:
- POLL_INTERVAL: 轮询间隔(秒), 默认30秒
- DB_PATH: 数据库路径
- WS_URL: 桌宠WebSocket地址
- HTTP_PORT: HTTP服务端口, 默认8765
"""
import sys, json, urllib.request, re, time, os, asyncio, subprocess, sqlite3, threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 配置
POLL_INTERVAL = 30  # 轮询间隔(秒)
# 使用工作目录中的数据库（避免trae-sandbox环境限制）
DB_PATH = 'trading.db'
WS_URL = "ws://127.0.0.1:18888"
PYTHON = r'D:\python34\python.exe'
HTTP_PORT = 8765  # HTTP服务端口

# 缓存数据（供UI查询）
cached_data = {
    'holdings': [],
    'candidates': [],
    'prices': {},
    'indexes': {},
    'update_time': ''
}

# 已推送的告警，避免重复
sent_alerts = {}
alert_cooldown = 300  # 同一告警5分钟内不再推送

def log(msg):
    t = time.strftime("%H:%M:%S")
    line = f"[{t}] {msg}"
    print(line)

# ============================================================
# 数据获取 - 腾讯API
# ============================================================
def fetch_prices(codes, timeout=8):
    """批量获取实时行情"""
    if not codes: return {}
    url = f"http://qt.gtimg.cn/q={','.join(codes)}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode('gbk', errors='replace')
    except Exception as e:
        log(f"❌ 腾讯API请求失败: {e}")
        return {}

    result = {}
    for m in re.finditer(r'v_(s[hz]\d{6})="(.+?)";', text):
        parts = m.group(2).split('~')
        if len(parts) < 40: continue
        try:
            code = parts[2]
            result[code] = {
                '名称': parts[1],
                '现价': float(parts[3]) if parts[3] else 0,
                '昨收': float(parts[4]) if parts[4] else 0,
                '今开': float(parts[5]) if parts[5] else 0,
                '涨幅%': float(parts[32]) if len(parts) > 32 and parts[32] else 0,
                '最高': float(parts[33]) if len(parts) > 33 and parts[33] else 0,
                '最低': float(parts[34]) if len(parts) > 34 and parts[34] else 0,
                '换手率%': float(parts[38]) if len(parts) > 38 and parts[38] else 0,
                '量比': float(parts[49]) if len(parts) > 49 and parts[49] else 0,
            }
        except (ValueError, IndexError):
            continue
    return result

# ============================================================
# 数据库操作
# ============================================================
def init_db_tables():
    """初始化数据库表（如果不存在）"""
    try:
        log(f"[DB] 初始化数据库表")
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        cur = conn.cursor()
        
        # 创建持仓表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS holdings (
                code TEXT PRIMARY KEY,
                name TEXT,
                buy_price REAL,
                shares INTEGER,
                stop_loss REAL,
                take_profit TEXT,
                status TEXT DEFAULT '当前持仓',
                sell_date TEXT,
                sell_price REAL
            )
        """)
        
        # 创建选股池表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_pool (
                code TEXT PRIMARY KEY,
                name TEXT,
                buy_point_1 REAL,
                buy_point_2 REAL,
                stop_loss REAL,
                take_profit TEXT,
                notes TEXT,
                date TEXT
            )
        """)
        
        conn.commit()
        conn.close()
        log("[DB] 数据库表初始化完成")
    except Exception as e:
        log(f"⚠️ 数据库初始化失败: {e}")

def load_holdings_from_db():
    """从数据库加载当前持仓"""
    try:
        log(f"[DB] 加载持仓数据，数据库路径: {DB_PATH}")
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        cur = conn.cursor()
        
        # 先检查表结构
        cur.execute("PRAGMA table_info(holdings)")
        columns = cur.fetchall()
        log(f"[DB] holdings表列: {[col[1] for col in columns]}")
        
        # 统计总记录数和状态分布
        cur.execute("SELECT status, COUNT(*) FROM holdings GROUP BY status")
        status_counts = cur.fetchall()
        log(f"[DB] holdings表状态分布: {status_counts}")
        
        # 查询所有字段（适配实际表结构）
        cur.execute("SELECT * FROM holdings WHERE status = '当前持仓'")
        rows = cur.fetchall()
        log(f"[DB] 查询到 {len(rows)} 条当前持仓记录")
        
        # 获取列名
        col_names = [col[1] for col in columns]
        
        conn.close()
        
        holdings = []
        for r in rows:
            # 使用字典推导式构建记录，适配不同表结构
            record = {}
            for i, col_name in enumerate(col_names):
                record[col_name] = r[i]
            
            # 统一字段名
            holdings.append({
                'code': record.get('code', ''),
                'name': record.get('name', ''),
                'cost': record.get('buy_price', record.get('cost', 0)),
                'shares': record.get('shares', 0),
                'stop_loss': record.get('stop_loss', 0),
                'take_profit': record.get('take_profit', ''),
                'status': record.get('status', '当前持仓'),
                'notes': record.get('notes', '')
            })
        log(f"[DB] 加载完成，共 {len(holdings)} 只持仓")
        return holdings
    except Exception as e:
        log(f"⚠️ 持仓加载失败: {type(e).__name__}: {e}")
        return []

def load_candidates_from_db(filter_type='today'):
    """从数据库加载选股池
    filter_type: 'today' - 今日股票池（日期筛选）, 'all' - 全部股票池
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL")
        cur = conn.cursor()
        
        if filter_type == 'today':
            # 今日股票池 - 按日期筛选
            cur.execute("""
                SELECT code, name, buy_point_1, buy_point_2, stop_loss, take_profit, notes, date 
                FROM stock_pool
                WHERE date = date('now')
            """)
        else:
            # 全部股票池 - 显示所有
            cur.execute("""
                SELECT code, name, buy_point_1, buy_point_2, stop_loss, take_profit, notes, date 
                FROM stock_pool
            """)
        
        rows = cur.fetchall()
        log(f"[DB] 选股池查询 - 类型:{filter_type}, 结果:{len(rows)}条")
        conn.close()
        
        candidates = []
        for r in rows:
            candidates.append({
                'code': r[0],
                'name': r[1],
                'buy_point_1': r[2],
                'buy_point_2': r[3],
                'stop_loss': r[4],
                'take_profit': r[5],
                'notes': r[6],
                'date': r[7] if len(r) > 7 else None
            })
        return candidates
    except Exception as e:
        log(f"⚠️ 候选池加载失败: {e}")
        return []

def update_all_holdings_status():
    """将所有持仓记录的状态更新为当前持仓（不包括已卖出的）"""
    try:
        log(f"[DB] 更新所有持仓状态为'当前持仓'")
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        
        # 先统计更新前的状态分布
        cur.execute("SELECT status, COUNT(*) FROM holdings GROUP BY status")
        before_counts = cur.fetchall()
        log(f"[DB] 更新前状态分布: {before_counts}")
        
        # 更新未卖出记录的状态为当前持仓（已卖出的保持不变）
        cur.execute("UPDATE holdings SET status = '当前持仓' WHERE status != '已卖出'")
        updated_count = cur.rowcount
        conn.commit()
        conn.close()
        
        log(f"[DB] 成功更新 {updated_count} 条持仓记录状态为'当前持仓'（已卖出的除外）")
        return updated_count
    except Exception as e:
        log(f"⚠️ 更新持仓状态失败: {type(e).__name__}: {e}")
        return 0

# ============================================================
# 解析止盈目标
# ============================================================
def parse_take_profit(take_profit_str):
    """解析止盈字符串 "19.81/21.40" -> (tp1, tp2)"""
    if not take_profit_str:
        return (0, 0)
    tp_parts = take_profit_str.split('/')
    tp1 = float(tp_parts[0]) if tp_parts[0] else 0
    tp2 = float(tp_parts[1]) if len(tp_parts) > 1 and tp_parts[1] else tp1
    return (tp1, tp2)

# ============================================================
# 告警分析
# ============================================================
def analyze_holdings(holdings, prices):
    """持仓池分析: 盈亏/止损/止盈预警"""
    alerts = []
    for h in holdings:
        code = h['code']
        p = prices.get(code)
        if not p: continue

        cur = p['现价']
        cost = h['cost']
        sl = h.get('stop_loss', 0)
        tp_str = h.get('take_profit', '')
        shares = h.get('shares', 0)
        
        tp1, tp2 = parse_take_profit(tp_str)

        pnl_pct = round((cur - cost) / cost * 100, 1)
        pnl_amt = round((cur - cost) * shares, 0) if shares else 0
        daily_pct = p['涨幅%']

        # 止损预警
        if sl > 0:
            if cur <= sl:
                key = f"sl_{code}"
                alerts.append({
                    'key': key,
                    'text': f"🚨 {h['name']}({code}) 触发止损！现价{cur:.2f} ≤ 止损{sl}",
                    'emotion': 'sad',
                    'priority': 0
                })
            elif cur <= sl * 1.03:
                delta = round((cur - sl) / sl * 100, 1)
                key = f"sl_near_{code}"
                alerts.append({
                    'key': key,
                    'text': f"⚠️ {h['name']}({code}) 距止损仅{delta}%！现价{cur:.2f}，止损{sl}",
                    'emotion': 'sad',
                    'priority': 1
                })

        # 止盈预警
        if tp1 > 0:
            if cur >= tp1:
                key = f"tp_{code}"
                alerts.append({
                    'key': key,
                    'text': f"🎉 {h['name']}({code}) 止盈第一目标达成！现价{cur:.2f} ≥ {tp1} (+{pnl_pct}%)",
                    'emotion': 'excited',
                    'priority': 0
                })
            elif cur >= tp1 * 0.98:
                delta = round((tp1 - cur) / tp1 * 100, 1)
                key = f"tp_near_{code}"
                alerts.append({
                    'key': key,
                    'text': f"📈 {h['name']}({code}) 接近止盈！现价{cur:.2f}，距{tp1}仅{delta}%",
                    'emotion': 'happy',
                    'priority': 2
                })

        # 大涨提醒
        if daily_pct >= 5:
            key = f"up_{code}"
            alerts.append({
                'key': key,
                'text': f"🚀 {h['name']}({code}) 大涨+{daily_pct}%！现价{cur:.2f}",
                'emotion': 'excited',
                'priority': 2
            })

        # 大跌提醒
        if daily_pct <= -5:
            key = f"down_{code}"
            alerts.append({
                'key': key,
                'text': f"💥 {h['name']}({code}) 大跌{daily_pct}%！现价{cur:.2f}",
                'emotion': 'sad',
                'priority': 1
            })

    return sorted(alerts, key=lambda x: x['priority'])

def analyze_candidates(candidates, prices):
    """选股池分析: 买点触发预警"""
    alerts = []
    for c in candidates:
        code = c['code']
        p = prices.get(code)
        if not p: continue

        cur = p['现价']
        bp1 = c.get('buy_point_1', 0)
        bp2 = c.get('buy_point_2', 0)
        sl = c.get('stop_loss', 0)

        # 买点触发
        if bp1 > 0:
            if cur <= bp1 * 1.01:
                delta = round((cur - bp1) / bp1 * 100, 1)
                key = f"buy_{code}"
                alerts.append({
                    'key': key,
                    'text': f"🎯 {c['name']}({code}) 触及买点！现价{cur:.2f} ≈ 买点{bp1}",
                    'emotion': 'excited',
                    'priority': 0
                })

        # 跌破止损（从选股池移除）
        if sl > 0 and cur <= sl:
            key = f"pool_sl_{code}"
            alerts.append({
                'key': key,
                'text': f"❌ {c['name']}({code}) 跌破止损{sl}，现价{cur:.2f}",
                'emotion': 'sad',
                'priority': 1
            })

    return sorted(alerts, key=lambda x: x['priority'])

# ============================================================
# WS推送
# ============================================================
async def push_to_pet(alerts):
    """推送告警到桌宠"""
    global sent_alerts
    
    try:
        import websockets
    except ImportError:
        subprocess.run([PYTHON, "-m", "pip", "install", "websockets"], capture_output=True)
        import websockets

    # 过滤重复告警
    now = time.time()
    filtered_alerts = []
    for a in alerts:
        last_sent = sent_alerts.get(a['key'], 0)
        if now - last_sent > alert_cooldown:
            filtered_alerts.append(a)
            sent_alerts[a['key']] = now

    if not filtered_alerts:
        log("ℹ️ 无新告警")
        return

    try:
        async with websockets.connect(WS_URL, open_timeout=3) as ws:
            for a in filtered_alerts:
                message = {
                    "type": "stock_alert",
                    "text": a['text'],
                    "emotion": a['emotion']
                }
                await ws.send(json.dumps(message, ensure_ascii=False))
                log(f"📤 {a['emotion']} | {a['text']}")
                await asyncio.sleep(0.3)
            
            log(f"✅ 推送完成: {len(filtered_alerts)}条")

    except Exception as e:
        log(f"❌ WS推送失败: {type(e).__name__}: {e}")

# ============================================================
# 交易时段检查
# ============================================================
def is_trading_time():
    """检查是否在交易时段"""
    now = datetime.now()
    # 周末休市
    if now.weekday() >= 5:
        log(f"⏸️ 周末休市 (周{['一','二','三','四','五','六','日'][now.weekday()]})")
        return False
    # 交易时段: 9:30-11:30, 13:00-15:00
    t = now.hour * 60 + now.minute
    if 570 <= t < 690 or 780 <= t < 900:
        return True
    log(f"⏸️ 非交易时段 ({now.strftime('%H:%M')})")
    return False

# ============================================================
# 主循环
# ============================================================
def monitor_loop():
    """持续监控主循环"""
    log("🚀 桌宠股票监控服务启动")
    log(f"📊 轮询间隔: {POLL_INTERVAL}秒")
    log(f"📡 推送地址: {WS_URL}")

    while True:
        # 检查交易时段
        if not is_trading_time():
            time.sleep(POLL_INTERVAL)
            continue

        try:
            # 1. 加载数据
            holdings = load_holdings_from_db()
            candidates = load_candidates_from_db()
            log(f"📋 持仓:{len(holdings)} | 候选:{len(candidates)}")

            # 2. 收集代码
            all_codes = []
            for h in holdings:
                prefix = 'sh' if h['code'].startswith('6') else 'sz'
                all_codes.append(f"{prefix}{h['code']}")
            for c in candidates:
                prefix = 'sh' if c['code'].startswith('6') else 'sz'
                all_codes.append(f"{prefix}{c['code']}")

            if not all_codes:
                time.sleep(POLL_INTERVAL)
                continue

            # 3. 获取实时价格
            prices = fetch_prices(all_codes)
            log(f"📡 获取到 {len(prices)} 只股票实时数据")

            # 4. 分析告警
            holding_alerts = analyze_holdings(holdings, prices)
            candidate_alerts = analyze_candidates(candidates, prices)
            
            all_alerts = holding_alerts + candidate_alerts
            all_alerts.sort(key=lambda x: x['priority'])

            # 5. 推送
            if all_alerts:
                asyncio.run(push_to_pet(all_alerts))

        except Exception as e:
            log(f"❌ 监控循环异常: {type(e).__name__}: {e}")

        # 等待下一轮
        time.sleep(POLL_INTERVAL)

# ============================================================
# HTTP API服务
# ============================================================
class StockHandler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        global cached_data
        
        log(f"[API-GET] 请求路径: {self.path}, 客户端: {self.client_address}")
        
        if self.path == '/api/stock_data':
            self.send_json(cached_data)
            log(f"[API-GET] 返回 stock_data, holdings:{len(cached_data['holdings'])}, candidates:{len(cached_data['candidates'])}")
        elif self.path == '/api/holdings':
            result = {'data': cached_data['holdings']}
            self.send_json(result)
            log(f"[API-GET] 返回 holdings: {len(cached_data['holdings'])} 条")
        elif self.path.startswith('/api/candidates'):
            # 解析URL参数
            filter_type = 'today'  # 默认今日股票池
            if 'filter=all' in self.path:
                filter_type = 'all'
            
            # 根据筛选类型获取数据
            candidates = load_candidates_from_db(filter_type)
            result = {'data': candidates, 'filter': filter_type}
            self.send_json(result)
            log(f"[API-GET] 返回 candidates: {len(candidates)} 条, 筛选类型: {filter_type}")
        elif self.path == '/api/prices':
            self.send_json({'data': cached_data['prices']})
            log(f"[API-GET] 返回 prices: {len(cached_data['prices'])} 条")
        elif self.path == '/api/indexes':
            self.send_json({'data': cached_data['indexes']})
            log(f"[API-GET] 返回 indexes")
        elif self.path == '/api/health':
            self.send_json({'status': 'ok', 'update_time': cached_data['update_time']})
            log(f"[API-GET] 返回 health")
        elif self.path == '/api/alpha_scan':
            self.handle_alpha_scan()
        elif self.path.startswith('/api/kline'):
            self.handle_kline()
        elif self.path.startswith('/api/analyze_etf'):
            self.handle_etf_analysis()
        elif self.path == '/api/hot_sectors':
            self.handle_hot_sectors()
        else:
            self.send_json({'error': 'Not found'}, 404)
            log(f"[API-GET] 未找到路径: {self.path}")
    
    def do_POST(self):
        global cached_data
        
        log(f"[API] 收到POST请求: {self.path}")
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            log(f"[API] 请求体长度: {content_length}, 内容: {body}")
            data = json.loads(body) if body else {}
            log(f"[API] 解析后的JSON数据: {data}")
        except Exception as e:
            log(f"[API] JSON解析失败: {e}")
            self.send_json({'error': 'Invalid JSON: ' + str(e)}, 400)
            return
        
        if self.path == '/api/add_stock':
            log("[API] 处理添加股票请求")
            code = data.get('code')
            name = data.get('name')
            
            if not code or not name:
                log(f"[API] 缺少必要参数: code={code}, name={name}")
                self.send_json({'error': 'Missing code or name'}, 400)
                return
            
            # 添加到数据库
            try:
                log(f"[API] 连接数据库: {DB_PATH}")
                conn = sqlite3.connect(DB_PATH)
                conn.execute("PRAGMA journal_mode=WAL")
                cur = conn.cursor()
                
                # 添加到选股池
                if data.get('buy_point_1'):
                    log(f"[API] 添加到选股池: {code} {name}")
                    cur.execute("""
                        INSERT OR REPLACE INTO stock_pool 
                        (code, name, buy_point_1, buy_point_2, stop_loss, take_profit, date, notes)
                        VALUES (?, ?, ?, ?, ?, ?, date('now'), '')
                    """, (code, name, 
                          data.get('buy_point_1') or 0, 
                          data.get('buy_point_2') or 0, 
                          data.get('stop_loss') or 0, 
                          data.get('take_profit') or ''))
                
                # 添加到持仓
                if data.get('cost') and data.get('shares'):
                    log(f"[API] 添加到持仓: {code} {name}, cost={data.get('cost')}, shares={data.get('shares')}")
                    cur.execute("""
                        INSERT INTO holdings 
                        (code, name, buy_date, buy_price, shares, stop_loss, take_profit, status)
                        VALUES (?, ?, date('now'), ?, ?, ?, ?, '当前持仓')
                    """, (code, name, 
                          data.get('cost'), 
                          data.get('shares'), 
                          data.get('stop_loss') or 0, 
                          data.get('take_profit') or ''))
                
                conn.commit()
                log("[API] 添加成功")
                self.send_json({'success': True, 'message': '添加成功'})
            except Exception as e:
                log(f"[API] 添加失败: {e}")
                self.send_json({'error': str(e)}, 500)
            finally:
                if 'conn' in locals():
                    conn.close()
        
        elif self.path == '/api/delete_stock':
            code = data.get('code')
            table = data.get('table')
            
            if not code or not table:
                self.send_json({'error': 'Missing code or table'}, 400)
                return
            
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.execute("PRAGMA journal_mode=WAL")
                cur = conn.cursor()
                
                if table == 'stock_pool':
                    cur.execute("DELETE FROM stock_pool WHERE code = ?", (code,))
                elif table == 'holdings':
                    cur.execute("UPDATE holdings SET status = '已卖出', sell_date = date('now') WHERE code = ? AND status = '当前持仓'", (code,))
                
                conn.commit()
                self.send_json({'success': True, 'message': '操作成功'})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            finally:
                if 'conn' in locals():
                    conn.close()
        
        elif self.path == '/api/update_alerts':
            code = data.get('code')
            table = data.get('table')
            stop_loss = data.get('stop_loss')
            take_profit = data.get('take_profit')
            
            if not code or not table:
                self.send_json({'error': 'Missing code or table'}, 400)
                return
            
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.execute("PRAGMA journal_mode=WAL")
                cur = conn.cursor()
                
                if table == 'stock_pool':
                    cur.execute("""
                        UPDATE stock_pool SET stop_loss = ?, take_profit = ? WHERE code = ?
                    """, (stop_loss or 0, take_profit or '', code))
                elif table == 'holdings':
                    cur.execute("""
                        UPDATE holdings SET stop_loss = ?, take_profit = ? WHERE code = ?
                    """, (stop_loss or 0, take_profit or '', code))
                
                conn.commit()
                self.send_json({'success': True, 'message': '更新成功'})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            finally:
                if 'conn' in locals():
                    conn.close()
        
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def handle_alpha_scan(self):
        """处理Alpha选股请求 - 多因子版本优先，失败自动降级"""
        log("[API] ===== Alpha选股扫描开始 ======")
        try:
            # 【改进】优先使用多因子版本
            fidstock_v2_path = os.path.join(os.path.dirname(__file__), 'FidStock_v2_integration.py')
            log(f"[API] 检查多因子模块路径: {fidstock_v2_path}")
            
            if os.path.exists(fidstock_v2_path):
                try:
                    log("[API] 正在加载多因子选股器...")
                    import importlib.util
                    
                    spec = importlib.util.spec_from_file_location("FidStock_v2", fidstock_v2_path)
                    if spec is None or spec.loader is None:
                        raise ImportError("无法加载FidStock_v2模块")
                    
                    FidStock_v2 = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(FidStock_v2)
                    
                    log("[API] ✅ 多因子选股器加载成功")
                    
                    # 执行多因子扫描
                    log("[API] 开始多因子扫描...")
                    log(f"[API] 参数: batch_size=50, max_stocks=100")  # 减少数量
                    
                    stocks = FidStock_v2.scan_stocks_multifactor(batch_size=50, max_stocks=100)
                    
                    log(f"[API] ✅ 多因子扫描完成，获得 {len(stocks)} 只股票")
                    
                    if stocks:
                        log(f"[API] 选股结果详情:")
                        for i, stock in enumerate(stocks[:5]):
                            name = stock.get('名称', stock.get('name', 'N/A'))
                            score = stock.get('评分', stock.get('score', 0))
                            log(f"[API]   {i+1}. {name} - 评分: {score}")
                    else:
                        log("[API] ⚠️ 多因子扫描结果为空，可能原因:")
                        log("[API]   - 非交易时段，数据源无数据")
                        log("[API]   - 评分阈值过高")
                        log("[API]   - 候选股票池为空")
                    
                    report = FidStock_v2.generate_report(stocks)
                    log(f"[API] ✅ 报告生成完成")
                    log(f"[API] 报告内容: {json.dumps(report, ensure_ascii=False)[:500]}...")
                    
                    # 推送WebSocket
                    if stocks:
                        try:
                            top_stock = stocks[0]
                            push_message = {
                                'type': 'alpha',
                                'text': f"🎯 多因子选股: {top_stock.get('名称', top_stock.get('name', 'N/A'))} {int(top_stock.get('评分', top_stock.get('score', 0)))}分",
                                'stocks': stocks[:5],
                                'total': len(stocks),
                                'method': 'multifactor'
                            }
                            asyncio.create_task(push_to_pet([push_message]))
                            log(f"[API] ✅ WebSocket推送成功")
                        except Exception as e:
                            log(f"[API] ⚠️ WebSocket推送失败: {e}")
                    
                    self.send_json(report)
                    log("[API] ✅ Alpha选股请求成功返回 (多因子版本)")
                    return
                    
                except Exception as e:
                    log(f"[API] ⚠️ 多因子扫描失败，降级到旧版本: {type(e).__name__}: {e}")
                    import traceback
                    log(f"[API] 错误详情:\n{traceback.format_exc()}")
            else:
                log(f"[API] ⚠️ FidStock_v2_integration.py 不存在，降级到旧版本")
            
            # 【降级方案】使用旧版本
            log("[API] 启动降级方案 - 加载旧版本FidStock")
            import importlib.util
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
                    push_message = {'type': 'alert', 'text': f"📈 选股完成: 推荐 {len(stocks)} 只股票"}
                    asyncio.create_task(push_to_pet([push_message]))
                except Exception as e:
                    log(f"[API] ⚠️ WebSocket推送失败: {e}")
            
            self.send_json(report)
            log("[API] ✅ Alpha选股请求成功返回 (旧版本)")
            
        except Exception as e:
            log(f"[API] ❌ Alpha选股彻底失败: {type(e).__name__}: {e}")
            import traceback
            log(f"[API] 错误详情:\n{traceback.format_exc()}")
            self.send_json({'error': f'Alpha选股失败: {str(e)}'}, 500)
        log("[API] ===== Alpha选股扫描结束 ======")
    
    def handle_kline(self):
        """处理K线数据请求"""
        import re
        match = re.search(r'/api/kline/([s]?[hz]?\d{6})', self.path)
        if not match:
            self.send_json({'error': 'Invalid stock code'}, 400)
            return
        
        code = match.group(1)
        
        if len(code) == 6 and code.isdigit():
            if code.startswith('6'):
                code = 'sh' + code
            else:
                code = 'sz' + code
        
        log(f"[API] 获取K线数据: {code}")
        
        try:
            import importlib.util
            import sys
            
            fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
            spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
            if spec is None or spec.loader is None:
                log("[API] ❌ 无法加载FidStock模块")
                self.send_json({'error': '无法加载FidStock模块'}, 500)
                return
            
            FidStock = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(FidStock)
            
            kline_data = FidStock.fetch_kline(code, days=60)
            log(f"[API] 获取K线数据成功: {len(kline_data)} 条")
            
            self.send_json({'code': code, 'data': kline_data})
            
        except Exception as e:
            log(f"[API] ❌ 获取K线失败: {type(e).__name__}: {e}")
            import traceback
            log(f"[API] 错误详情:\n{traceback.format_exc()}")
            self.send_json({'error': f'获取K线失败: {str(e)}'}, 500)
    
    def handle_etf_analysis(self):
        """处理ETF分析请求 GET /api/analyze_etf?code=512380"""
        import re
        match = re.search(r'code=(sh|sz)?(\d{6})', self.path)
        if not match:
            self.send_json({'error': '缺少code参数'}, 400)
            return
        
        prefix = match.group(1) or ''
        code_num = match.group(2)
        if prefix:
            code = prefix + code_num
        else:
            # 159xxx是深圳ETF，其他默认上海
            code = 'sz' + code_num if code_num.startswith('159') else 'sh' + code_num
        
        log(f"[API] ETF分析请求: {code}")
        
        try:
            from analyzers import ETFAnalyzer
            etf_analyzer = ETFAnalyzer()
            
            # 获取K线数据
            import importlib.util
            fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock.py')
            spec = importlib.util.spec_from_file_location("FidStock", fidstock_path)
            FidStock = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(FidStock)
            
            kline_data = FidStock.fetch_kline(code, days=60)
            if not kline_data or len(kline_data) < 20:
                self.send_json({'error': '数据不足'}, 400)
                return
            
            etf_info = {'code': code, 'name': f'ETF_{code}', 'category': 'unknown'}
            result = etf_analyzer.analyze(etf_info, kline_data)
            
            log(f"[API] ✅ ETF分析完成: {code}, 评分={result.get('score', 0):.1f}")
            self.send_json(result)
            
        except ImportError:
            log(f"[API] ⚠️ 多因子模块不可用，降级处理")
            self.send_json({'code': code, 'error': '多因子模块不可用'}, 400)
        except Exception as e:
            log(f"[API] ❌ ETF分析失败: {type(e).__name__}: {e}")
            self.send_json({'error': f'ETF分析失败: {str(e)}'}, 500)
    
    def handle_hot_sectors(self):
        """获取热点板块 GET /api/hot_sectors"""
        log(f"[API] 获取热点板块请求")
        
        try:
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
    
    def log_message(self, format, *args):
        pass  # 禁止默认日志输出

def start_http_server():
    """启动HTTP服务"""
    server = ThreadingHTTPServer(('127.0.0.1', HTTP_PORT), StockHandler)
    log(f"🌐 HTTP服务启动: http://127.0.0.1:{HTTP_PORT}")
    server.serve_forever()

# ============================================================
# 主循环
# ============================================================
def monitor_loop():
    """持续监控主循环"""
    global cached_data
    
    log("🚀 桌宠股票监控服务启动")
    log(f"📊 轮询间隔: {POLL_INTERVAL}秒")
    log(f"📡 推送地址: {WS_URL}")
    log(f"🌐 HTTP端口: {HTTP_PORT}")

    while True:
        # 检查交易时段
        if not is_trading_time():
            time.sleep(POLL_INTERVAL)
            continue

        try:
            # 1. 加载数据
            holdings = load_holdings_from_db()
            candidates = load_candidates_from_db()
            log(f"📋 持仓:{len(holdings)} | 候选:{len(candidates)}")

            # 2. 收集代码
            all_codes = []
            for h in holdings:
                prefix = 'sh' if h['code'].startswith('6') else 'sz'
                all_codes.append(f"{prefix}{h['code']}")
            for c in candidates:
                prefix = 'sh' if c['code'].startswith('6') else 'sz'
                all_codes.append(f"{prefix}{c['code']}")

            if not all_codes:
                time.sleep(POLL_INTERVAL)
                continue

            # 3. 获取实时价格
            prices = fetch_prices(all_codes)
            log(f"📡 获取到 {len(prices)} 只股票实时数据")

            # 4. 获取指数数据
            index_prices = fetch_prices(['sh000001', 'sz399001', 'sz399006'])
            
            # 5. 更新缓存
            cached_data['holdings'] = holdings
            cached_data['candidates'] = candidates
            cached_data['prices'] = prices
            cached_data['indexes'] = index_prices
            cached_data['update_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

            # 6. 分析告警
            holding_alerts = analyze_holdings(holdings, prices)
            candidate_alerts = analyze_candidates(candidates, prices)
            
            all_alerts = holding_alerts + candidate_alerts
            all_alerts.sort(key=lambda x: x['priority'])

            # 7. 推送
            if all_alerts:
                try:
                    asyncio.run(push_to_pet(all_alerts))
                except Exception as e:
                    log(f"⚠️ 推送失败: {e}")

        except Exception as e:
            log(f"❌ 监控循环异常: {type(e).__name__}: {e}")

        # 等待下一轮
        time.sleep(POLL_INTERVAL)

# ============================================================
# 入口
# ============================================================
if __name__ == '__main__':
    print(f"[启动] 数据库路径: {DB_PATH}")
    print(f"[启动] 文件存在: {os.path.exists(DB_PATH)}")
    
    # 连接数据库
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.close()
    print(f"[启动] 数据库连接成功")
    
    # 初始化数据库表（如果表不存在则创建）
    init_db_tables()
    
    # 将所有持仓状态更新为当前持仓（确保数据正确）
    update_all_holdings_status()
    
    # 立即加载数据到缓存（启动时就有数据）
    print("[启动] 加载初始数据...")
    cached_data['holdings'] = load_holdings_from_db()
    cached_data['candidates'] = load_candidates_from_db()
    cached_data['update_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[启动] 加载完成: 持仓{len(cached_data['holdings'])}只, 候选{len(cached_data['candidates'])}只")
    
    # 启动HTTP服务线程
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()
    
    # 启动监控循环
    monitor_loop()
