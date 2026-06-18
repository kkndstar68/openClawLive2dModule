// WebSocket 连接模块，用于与 OpenClaw Gateway 通信 (桌面宠物前端版本)

class OpenClawWebSocket {
  private ws: WebSocket | null = null;
  private url: string = 'ws://127.0.0.1:18789';
  // 替换成你自己的 token
  private token: string = 'b43f34201aa00efc5d19150d9e8887df5d70773c565ef7d0';  //wsl
  //private token: string = '7d900e227de26d4b89c1714c79720bebf2bec0142ee5e916';  //wsl
  private connected: boolean = false;
  private messageId: number = 1;
  private eventListeners: Map<string, ((data: any) => void)[]> = new Map();
  
  // 用于拼接流式回复的缓存
  private currentResponse: { runId: string; text: string } | null = null;

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.connected) {
        resolve(true);
        return;
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('🔗 WebSocket TCP连接已建立，准备发送握手...');
        // 注意：这里不要设 connected = true，要等握手成功
        this.sendConnectHandshake();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket 错误:', error);
      };

      this.ws.onclose = (event) => {
        console.log(`🔌 WebSocket 连接已关闭 (代码: ${event.code})`);
        this.connected = false;
        this.emit('disconnected');
        // 可以考虑在这里加个 setTimeout 自动重连
      };

      // 给个 3 秒超时
      setTimeout(() => {
        resolve(this.connected);
      }, 3000);
    });
  }
// id: "desktop-pet",
  // 发送握手请求 (完全抄袭 VSCode 源码的成功参数)
  private sendConnectHandshake() {
    const requestId = `connect-${Date.now()}`;
    const request = {
      type: "req",
      id: requestId,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "cli",
          version: "1.0.0",
          platform: "win32",
          mode: "cli"      // 🔑 核心密码在这里！必须是 cli
        },
        auth: {
          token: this.token
        },
        locale: "zh-CN"
      }
    };
    
    console.log('📤 发送握手请求:', request);
    this.send(request);
  }

  // 发送聊天消息
  sendMessage(text: string, sessionKey: string = 'main') {
    if (!this.connected || !this.ws) {
      console.error('❌ 未连接到 OpenClaw，无法发送消息');
      return;
    }

    const requestId = `msg-${this.messageId++}`;
    const request = {
      type: "req",
      id: requestId,
      method: "agent",     // 🔑 核心密码2：发消息用 agent 方法
      params: {
        message: text,
        sessionKey: sessionKey,
        idempotencyKey: `pet-${Date.now()}-${Math.random().toString(36).substring(7)}`
      }
    };

    console.log('🗣️ 告诉老婆:', text);
    this.send(request);
  }

  // 处理收到的消息
  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // 1. 处理握手结果
      if (message.type === 'res' && message.id?.startsWith('connect-')) {
        if (message.ok) {
          console.log('✅ 握手成功！老婆连上线了！');
          this.connected = true;
          this.emit('connected');
        } else {
          console.error('❌ 握手失败:', message.error);
        }
        return;
      }

      // 2. 忽略挑战事件 (VSCode 也是这么干的)
      if (message.type === 'event' && message.event === 'connect.challenge') {
        return;
      }

      // 3. 处理流式文字输出 (Stream)
      if (message.type === 'event' && message.event === 'agent') {
        const payload = message.payload;
        
        // 当模型正在吐字时
        if (payload && (payload.stream === 'stdout' || payload.stream === 'assistant')) {
          const runId = payload.runId;
          const streamData = payload.data;
          
          if (streamData && streamData.text) {
            // 拼凑文字
            if (!this.currentResponse || this.currentResponse.runId !== runId) {
              this.currentResponse = { runId, text: streamData.text };
            } else {
              this.currentResponse.text = streamData.text;
            }
            
            // 【可选】实时打字机效果：如果你想让她一边想一边显示气泡，监听这个 stream 事件
            this.emit('stream', this.currentResponse.text);
          }
        }
        // 当模型一句话说完了 (生命周期结束)
        else if (payload && payload.stream === 'lifecycle') {
          const streamData = payload.data;
          const runId = payload.runId;
          
          if (streamData && streamData.phase === 'end' && this.currentResponse && this.currentResponse.runId === runId) {
            console.log('💌 老婆回复完毕:', this.currentResponse.text);
            
            // 触发 message 事件，把整段话交给 TTS 去转语音
            this.emit('message', this.currentResponse.text);
            this.currentResponse = null; // 清空缓存，准备迎接下一句话
          }
        }
      }
    } catch (error) {
      console.error('解析 WebSocket 消息失败:', error);
    }
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // 事件订阅机制
  on(event: string, callback: (data: any) => void) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)?.push(callback);
  }

  // 内部事件触发机制
  private emit(event: string, data?: any) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`事件 ${event} 的回调执行失败:`, error);
        }
      });
    }
  }

  // 关闭连接
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      console.log('🔌 主动断开与老婆的神经连接');
    }
  }

  // 检查连接状态
  isConnected(): boolean {
    return this.connected;
  }
}

// 导出单例，方便在 Vue3 的各个组件中直接 import 使用
export const openClawWebSocket = new OpenClawWebSocket();
