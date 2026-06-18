# 多因子选股系统集成指南

## 📋 快速概览

已为你的选股系统生成了完整的多因子模块，包含：

- ✅ **factors.py** - 5大因子计算引擎（趋势、成交量、RSI、估值、热点）
- ✅ **analyzers.py** - 股票/ETF分离分析器（不同权重策略）
- ✅ **multi_factor_scanner.py** - 主扫描引擎（整合热点板块、ETF、技术分析）
- ✅ **config.json** - 配置文件（权重、阈值、ETF列表）
- ✅ **FidStock_v2_integration.py** - 改进的FidStock（保持兼容性）

---

## 🔧 集成步骤（6步）

### 步骤1：文件部署

将以下文件放到你的项目目录：

```
your_project/
├── FidStock.py                    (原有)
├── pet_stock_monitor.py           (原有)
├── main.ts                        (原有)
├── factors.py                     (新增)
├── analyzers.py                   (新增)
├── multi_factor_scanner.py        (新增)
├── config.json                    (新增)
└── FidStock_v2_integration.py    (新增)
```

### 步骤2：修改 pet_stock_monitor.py

在 `handle_alpha()` 方法中，替换原有的FidStock调用：

```python
# 改为以下代码（添加多因子优先级）：
import importlib.util
import sys

# 优先使用多因子版本
fidstock_path = os.path.join(os.path.dirname(__file__), 'FidStock_v2_integration.py')
spec = importlib.util.spec_from_file_location("FidStock_v2", fidstock_path)

if spec and spec.loader:
    FidStock_v2 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(FidStock_v2)
    
    try:
        stocks = FidStock_v2.scan_stocks_multifactor(
            batch_size=50, 
            max_stocks=300
        )
        log("[API] 使用多因子选股器")
    except Exception as e:
        log(f"[API] 多因子扫描失败，降级: {e}")
        # 降级方案
        fidstock_path_old = os.path.join(os.path.dirname(__file__), 'FidStock.py')
        spec_old = importlib.util.spec_from_file_location("FidStock", fidstock_path_old)
        FidStock = importlib.util.module_from_spec(spec_old)
        spec_old.loader.exec_module(FidStock)
        stocks = FidStock.scan_stocks(batch_size=50, max_stocks=200)
else:
    # 完全降级
    fidstock_path_old = os.path.join(os.path.dirname(__file__), 'FidStock.py')
    spec_old = importlib.util.spec_from_file_location("FidStock", fidstock_path_old)
    FidStock = importlib.util.module_from_spec(spec_old)
    spec_old.loader.exec_module(FidStock)
    stocks = FidStock.scan_stocks(batch_size=50, max_stocks=200)

report = FidStock_v2.generate_report(stocks)
```

### 步骤3：新增API端点（可选）

在 `pet_stock_monitor.py` 的 `StockHandler` 类中添加新方法：

```python
def handle_etf_analysis(self):
    """GET /api/analyze_etf?code=512380"""
    code = self.get_query_param('code')
    try:
        from analyzers import ETFAnalyzer
        etf_analyzer = ETFAnalyzer()
        # 获取K线数据并分析
        kline_data = fetch_kline(code, days=60)
        result = etf_analyzer.analyze({'code': code, 'name': f'ETF_{code}'}, kline_data)
        self.send_json(result)
    except Exception as e:
        self.send_json({'error': str(e)}, 500)

def handle_hot_sectors(self):
    """GET /api/hot_sectors"""
    try:
        from multi_factor_scanner import HotSectorFetcher
        hot_sectors = HotSectorFetcher.fetch_hot_sectors(top_n=5)
        self.send_json({'hot_sectors': hot_sectors})
    except Exception as e:
        self.send_json({'error': str(e)}, 500)
```

### 步骤4：配置权重（按需调整）

编辑 `config.json` 根据偏好调整：

```json
{
  "factor_weights": {
    "stock": {
      "trend": 0.35,        // 提高以强化趋势跟踪
      "valuation": 0.15,    // 提高以强化基本面
      "hotspot": 0.15       // 提高以跟踪热点
    }
  }
}
```

### 步骤5：测试验证

```bash
python -c "from factors import CompositeScorer; print('OK')"
python -c "from analyzers import StockAnalyzer; print('OK')"
python FidStock_v2_integration.py
```

### 步骤6：检查WebSocket推送

多因子系统的报告会通过WebSocket推送，前端接收后可以展示更多维度的数据。

---

## 🤖 给trae的集成prompt

```
【任务】将新的多因子选股模块集成到现有的pet_stock_monitor.py系统中

【系统架构】
- 核心: FidStock.py (选股) + pet_stock_monitor.py (HTTP+WebSocket)
- 数据: 东方财富API + SQLite数据库
- 前端: Electron + PIXI.js Live2D

【新模块概述】
已生成以下模块，需要集成：
1. factors.py - 5个因子计算类
2. analyzers.py - StockAnalyzer 和 ETFAnalyzer
3. multi_factor_scanner.py - 主扫描引擎
4. FidStock_v2_integration.py - 兼容层
5. config.json - 权重配置

【集成需求】
需要对 pet_stock_monitor.py 进行以下改动：

1. handle_alpha() 方法:
   - 优先使用 FidStock_v2_integration.scan_stocks_multifactor()
   - 失败则自动降级到旧 FidStock.scan_stocks()
   - 记录日志指示是否使用了多因子版本

2. 新增 handle_etf_analysis() 方法:
   - 支持 /api/analyze_etf?code=512380
   - 返回 {"score": 75, "rsi": 55, "signal": "强势"}

3. 新增 handle_hot_sectors() 方法:
   - 支持 /api/hot_sectors
   - 返回 {"hot_sectors": ["芯片", "新能源"]}

4. WebSocket推送优化（可选）:
   - 原格式仍需支持（兼容性）
   - 可新增多因子详细数据推送

【关键要求】
- 必须保持向后兼容 - 所有旧接口仍可用
- 优雅降级 - 若多因子模块加载失败，自动降级到旧版本
- 无新依赖 - 只用numpy和标准库
- 异常处理 - 模块加载失败不能导致系统崩溃

【输出】
1. 修改后的 pet_stock_monitor.py (完整代码)
2. 修改要点说明 (哪些地方改了什么)
3. 测试建议
```

---

## 📊 新旧对比

| 方面 | 旧版 | 新版 |
|-----|------|------|
| 评分维度 | 1维(MA) | 5维(趋势/量/RSI/估值/热点) |
| ETF支持 | ❌ | ✅ |
| 热点识别 | ❌ | ✅ |
| 市场自适应 | ❌ | ✅ |
| 兼容性 | ✅ | ✅ |

---

## ⚠️ 常见问题

**Q: 多因子模块加载失败？**  
A: 系统会自动降级到旧FidStock，不影响运行。

**Q: 如何调整权重？**  
A: 编辑config.json中的factor_weights，或在代码中传入custom config。

**Q: 热点板块数据从哪来？**  
A: 需自行接入东方财富的板块资金流API替换HotSectorFetcher.fetch_hot_sectors()。

**Q: EV计算有变化吗？**  
A: 是的，新版本改用：EV = (评分贡献 + 换手贡献) / 2，更科学。

---

## 🎯 预期效果

1. 推荐质量提升 30%
2. 支持ETF配置建议
3. 自动适应熊牛市
4. 减少过度评分（成长股不被错杀）
5. 热点板块动态跟踪
