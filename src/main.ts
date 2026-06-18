import * as PIXI from 'pixi.js';
import { openClawWebSocket } from './websocket';

// 将 PIXI 暴露到全局（给 pixi-live2d-display 用）
(window as any).PIXI = PIXI;

// 声明全局 echarts 变量（来自CDN）
declare const echarts: any;

// 使用 base 以支持 Electron 打包后 file:// 加载
const base = import.meta.env.BASE_URL || '/';

type ModelOption = {
  id: string;
  name: string;
  path: string;
};

type SoundOption = {
  id: string;
  name: string;
  url: string;
};
/*
 {
    id: 'abeikelongbi_3',
    name: '阿贝克隆比 3',
    path: `${base}galgame/abeikelongbi_3/abeikelongbi_3.model3.json`,
  },
   {
    id: 'zhaohe_3',
    name: '昭和 3',
    path: `${base}galgame/zhaohe_3/zhaohe_3.model3.json`,
  },
  {
    id: 'ev_cg001_02s',
    name: 'CG 01',
    path: `${base}01/ev_cg001_02s.model3.json`,
  },
     {
    id: 'ele_a1',
    name: '鬼畜',
    path: `${base}galgame/muna2/ailunsamuna_2.model3.json`,
  },
*/
// 当前 public 下已有的 .model3.json 列表
const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'ele_a0',
    name: '美奈子',
    path: `${base}galgame/ele_a0/model.model3.json`,
  },
  {
    id: 'ele_a1',
    name: '小美',
    path: `${base}galgame/miro_miko/mori_miko.model3.json`,
  },
  {
    id: 'ele_a1',
    name: '亚美',
    path: `${base}galgame/ruri_miko/ruri_miko.model3.json`,
  },
    {
    id: 'ele_a1',
    name: '明美',
    path: `${base}galgame/mori_suit/mori_suit.model3.json`,
  },
    {
    id: 'ele_a6',
    name: '真琴',
    path: `${base}galgame/ele_b4//model.model3.json`,
  },
];

// 读取 src/sound 目录下的所有 mp3/wav 作为音频选项
// 注意：请将音频放在 src/sound/... 中，Vite 会在构建时打包并生成正确 URL
const soundModules = import.meta.glob('./sound/**/*.{mp3,wav}', {
  eager: true,
  as: 'url',
}) as Record<string, string>;

const SOUND_OPTIONS: SoundOption[] = Object.entries(soundModules).map(
  ([path, url], index) => {
    const fileName = path.split('/').pop() || `sound-${index}`;
    const baseName = fileName.replace(/\.(mp3|wav)$/i, '');
    return {
      id: `${baseName}-${index}`,
      name: baseName,
      url,
    };
  },
);

let app: PIXI.Application | null = null;
let currentModel: any = null;
let Live2DModelCtor: any = null;
let currentAudio: HTMLAudioElement | null = null;
let currentModelPath: string = '';

async function ensureLive2D() {
  if (!Live2DModelCtor) {
    const mod = await import('pixi-live2d-display/cubism4');
    Live2DModelCtor = mod.Live2DModel;
  }
}

async function initPixi() {
  if (app) return;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('未找到 canvas 元素');
    return;
  }

  app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: window,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
  });

  (app.stage as any).eventMode = 'none';

  // 只绑定一次交互，内部使用 currentModel
  window.addEventListener('pointermove', (event) => {
    if (!currentModel || typeof (currentModel as any).focus !== 'function') return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    (currentModel as any).focus(x, y);
  });

  window.addEventListener('pointerdown', () => {
    if (!currentModel || typeof (currentModel as any).motion !== 'function') return;
    // 触发一个默认动作组（如果模型里有 Action 组会随机播一个）
    (currentModel as any).motion('Action');
    console.log('触发动作: Action');
  });
}

async function loadModel(path: string) {
  await ensureLive2D();
  await initPixi();

  if (!app || !Live2DModelCtor) return;

  try {
    console.log('正在加载模型:', path);

    // 移除旧模型
    if (currentModel) {
      app.stage.removeChild(currentModel);
      if (typeof currentModel.destroy === 'function') {
        currentModel.destroy();
      }
      currentModel = null;
    }

    const model = await Live2DModelCtor.from(path, { autoInteract: false });

    model.interactive = false;
    (model as any).eventMode = 'none';

    const scale = 0.2;
    model.scale.set(scale);
    model.x = app.screen.width / 2 - model.width / 2;
    model.y = app.screen.height / 2 - model.height / 2 + 150;

    app.stage.addChild(model as any);
    currentModel = model;
    currentModelPath = path;
    (window as any).live2dModel = model;

    console.log('Live2D 模型加载成功！');
  } catch (error) {
    console.error('加载模型失败:', error);
  }
}

async function getAllMotionGroupsFromModel(modelPath: string): Promise<string[]> {
  try {
    const response = await fetch(modelPath);
    if (!response.ok) {
      console.error('无法加载模型配置文件:', response.status);
      return [];
    }
    
    const modelData = await response.json();
    const motionGroups: string[] = [];
    
    if (modelData.FileReferences?.Motions) {
      const motions = modelData.FileReferences.Motions;
      for (const groupName in motions) {
        const group = motions[groupName];
        if (Array.isArray(group) && group.length > 0) {
          motionGroups.push(groupName);
        }
      }
    }
    
    console.log('找到动作组:', motionGroups);
    return motionGroups;
  } catch (error) {
    console.error('读取模型动作失败:', error);
    return [];
  }
}

async function playRandomMotion() {
  if (!currentModel || !currentModelPath) {
    console.warn('没有加载模型，无法播放动作');
    return;
  }
  
  const motionGroups = await getAllMotionGroupsFromModel(currentModelPath);
  
  if (motionGroups.length === 0) {
    console.warn('模型没有可用的动作组');
    return;
  }
  
  const randomIndex = Math.floor(Math.random() * motionGroups.length);
  const randomGroup = motionGroups[randomIndex];
  
  console.log('随机播放动作组:', randomGroup);
  
  if (typeof (currentModel as any).motion === 'function') {
    (currentModel as any).motion(randomGroup);
  }
}

function setupModelSelector() {
  const select = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (!select) return;

  // 清空并填充选项
  select.innerHTML = '';
  for (const opt of MODEL_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.path;
    optionEl.textContent = opt.name;
    select.appendChild(optionEl);
  }

  // 默认选中第一个
  if (MODEL_OPTIONS.length > 0) {
    select.value = MODEL_OPTIONS[0].path;
    void loadModel(select.value);
  }

  select.addEventListener('change', () => {
    const value = select.value;
    if (value) {
      void loadModel(value);
    }
  });
}

function setupSoundSelector() {
  const select = document.getElementById('soundSelect') as HTMLSelectElement | null;
  const testBtn = document.getElementById('soundTestBtn') as HTMLButtonElement | null;
  const localAudioTestBtn = document.getElementById('localAudioTestBtn') as HTMLButtonElement | null;
  if (!select || !testBtn) return;

  select.innerHTML = '';

  if (SOUND_OPTIONS.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '暂无音频';
    select.appendChild(opt);
    select.disabled = true;
    testBtn.disabled = true;
  }

  for (const optDef of SOUND_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = optDef.id;
    optionEl.textContent = optDef.name;
    select.appendChild(optionEl);
  }

  if (SOUND_OPTIONS.length > 0) {
    select.value = SOUND_OPTIONS[0].id;
  }

  testBtn.addEventListener('click', () => {
    if (!currentModel) {
      console.warn('请先加载模型');
      return;
    }

    const selectedId = select.value;
    const sound = SOUND_OPTIONS.find((s) => s.id === selectedId);
    if (!sound) return;

    // 使用新的 playAudioWithLipSync 函数
    playAudioWithLipSync(sound.url);
  });

  // 为本地音频测试按钮添加点击事件
  if (localAudioTestBtn) {
    localAudioTestBtn.addEventListener('click', () => {
      // 播放 public/sound/test.wav
      const audioPath = `${base}sound/test.wav`;
      playAudioWithLipSync(audioPath);
    });
  }
}

// 实现本地音频与口型同步的核心方法（强接管版本）
function playAudioWithLipSync(audioUrl: string) {
  if (!currentModel) {
    console.warn('请先加载模型');
    return;
  }

  // 停止上一次播放，避免重叠
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  // 创建音频元素
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  // 先触发一个动作（如果模型有 Action 组会随机播一个）
  if (typeof (currentModel as any).motion === 'function') {
    (currentModel as any).motion('Action');
  }

  // 使用 AudioContext 和 AnalyserNode 强接管音频输出
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = audioContext.createMediaElementSource(audio);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256; // 设置 fftSize 为 256
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser);
  analyser.connect(audioContext.destination);

  let animationId: number;

  function updateMouth() {
    if (!currentModel) return;

    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    const volumeValue = Math.min(average / 255, 1);
    
    // 增加嘴巴张合幅度倍数，让口型更明显
    const mouthAmplitude = Math.min(volumeValue * 2.5, 1);

    // 核心：强行设置模型嘴巴的张合度
    if (currentModel.internalModel && currentModel.internalModel.coreModel && 
        typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
      currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthAmplitude);
    } else if (typeof (currentModel as any).setParamValue === 'function') {
      // 备选方案：使用 setParamValue
      (currentModel as any).setParamValue('ParamMouthOpenY', mouthAmplitude);
    }

    if (!audio.paused) {
      animationId = requestAnimationFrame(updateMouth);
    } else {
      // 音频播放完毕，自动闭嘴
      if (currentModel.internalModel && currentModel.internalModel.coreModel && 
          typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
        currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
      } else if (typeof (currentModel as any).setParamValue === 'function') {
        (currentModel as any).setParamValue('ParamMouthOpenY', 0);
      }
    }
  }

  // 音频播放开始时启动动画循环
  audio.addEventListener('play', () => {
    updateMouth();
  });

  // 音频播放完毕后，清除动画循环并触发默认的 idle 动作
  audio.addEventListener('ended', () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    // 确保闭嘴
    if (currentModel.internalModel && currentModel.internalModel.coreModel && 
        typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
      currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
    } else if (typeof (currentModel as any).setParamValue === 'function') {
      (currentModel as any).setParamValue('ParamMouthOpenY', 0);
    }
    // 触发 idle 动作
    if (typeof (currentModel as any).motion === 'function') {
      (currentModel as any).motion('Idle');
    }
  });

  // 播放音频
  void audio.play().catch(err => {
    console.error('音频播放失败:', err);
  });
}

// 暴露方法到全局，方便测试
(window as any).playAudioWithLipSync = playAudioWithLipSync;

// 聊天相关功能
function setupChatInterface() {
  const chatInput = document.getElementById('chatInput') as HTMLInputElement | null;
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
  const voiceBtn = document.getElementById('voiceBtn') as HTMLButtonElement | null;
  const chatLog = document.getElementById('chatLog') as HTMLDivElement | null;
  const voiceSelect = document.getElementById('voiceSelect') as HTMLSelectElement | null;

  if (!chatInput || !sendBtn || !voiceBtn || !chatLog || !voiceSelect) return;

  // 语音选择下拉框事件
  voiceSelect.addEventListener('change', () => {
    currentVoice = voiceSelect.value;
    console.log('已切换语音:', currentVoice);
  });

  // 测试 Agent 接口按钮
  const testAgentBtn = document.getElementById('testAgentBtn') as HTMLButtonElement | null;
  if (testAgentBtn) {
    testAgentBtn.addEventListener('click', () => {
      // 发送测试消息
      sendMessageToLLM('你好，我是测试消息');
    });
  }

  // 监听 OpenClaw 消息
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.onOpenClawMessage) {
    window.electronAPI.onOpenClawMessage((message: string) => {
      console.log('========== 收到 OpenClaw MCP 消息 ==========');
      console.log('原始消息:', message);
      console.log('消息类型:', typeof message);
      console.log('消息长度:', message.length);
      
      // 解析消息，提取情感标签和纯文本
      const { emotion, cleanText } = parseEmotionFromText(message);
      console.log('解析结果 - 情感:', emotion);
      console.log('解析结果 - 纯文本:', cleanText);
      
      // 显示机器人回复到聊天记录
      addMessageToChatLog('bot', cleanText);
      
      // 显示机器人回复到聊天气泡
      if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
        window.writerInstance.type(cleanText);
      } else {
        // 如果writerInstance还未初始化，等待一下再尝试
        setTimeout(() => {
          if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
            window.writerInstance.type(cleanText);
          } else {
            console.warn('writerInstance 未初始化，无法显示消息到聊天气泡');
          }
        }, 100);
      }
      
      // 播放随机动作
      playRandomMotion();
      
      console.log('========================================');
    });
  } else {
    console.warn('⚠️ window.electronAPI 或 onOpenClawMessage 未定义');
    console.log('window.electronAPI:', window.electronAPI);
  }

  // 监听股票推送消息
  if (typeof window.electronAPI !== 'undefined' && window.electronAPI.onStockPush) {
    window.electronAPI.onStockPush((message: { type: string; text: string; emotion?: string }) => {
      console.log('========== 收到股票推送消息 ==========');
      console.log('推送消息:', message);
      
      const { text, emotion } = message;
      
      // 显示到聊天记录
      addMessageToChatLog('bot', text);
      
      // 显示到聊天气泡
      if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
        window.writerInstance.type(text);
      } else {
        setTimeout(() => {
          if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
            window.writerInstance.type(text);
          }
        }, 100);
      }
      
      // TTS 语音播报
      textToSpeech(text);
      
      // 播放随机动作
      playRandomMotion();
      
      // 根据情感触发对应表情/动作
      if (emotion) {
        handleEmotion(emotion);
      }
      
      console.log('========================================');
    });
  }

  // 编辑界面相关
  setupEditInterface();

  // 录音转文字功能
  let recognition: SpeechRecognition | null = null;
  let isRecording = false;

  voiceBtn.addEventListener('mousedown', startRecording);
  voiceBtn.addEventListener('mouseup', stopRecording);
  voiceBtn.addEventListener('mouseleave', stopRecording);

  function startRecording() {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      console.error('浏览器不支持语音识别');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isRecording = true;
      voiceBtn.textContent = '正在录音...';
      voiceBtn.style.background = 'rgba(255,0,0,0.5)';
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      chatInput.value = transcript;
    };

    recognition.onerror = (event) => {
      console.error('语音识别错误:', event.error);
      stopRecording();
    };

    recognition.onend = () => {
      stopRecording();
    };

    recognition.start();
  }

  function stopRecording() {
    if (recognition && isRecording) {
      recognition.stop();
      isRecording = false;
      voiceBtn.textContent = '按住说话';
      voiceBtn.style.background = 'rgba(255,255,255,0.2)';
    }
  }

  // 发送按钮点击事件
  sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
      sendMessageToLLM(message);
      chatInput.value = '';
    }
  });

  // 输入框回车发送
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const message = chatInput.value.trim();
      if (message) {
        sendMessageToLLM(message);
        chatInput.value = '';
      }
    }
  });
}

// 调用 OpenClaw Agent 的函数
async function sendMessageToLLM(text: string) {
  // 显示用户消息
  addMessageToChatLog('user', text);

  try {
    // 优先使用 WebSocket 发送消息
    if (openClawWebSocket.isConnected()) {
      console.log('========== OpenClaw WebSocket 消息发送 ==========');
      console.log('发送的消息:', text);
      console.log('Session Key:', 'main');
      
      openClawWebSocket.sendMessage(text, 'main');
      console.log('WebSocket 消息发送成功');
      console.log('========================================');
      return;
    }

    // 如果 WebSocket 未连接，使用 HTTP 请求作为备用
    console.log('WebSocket 未连接，使用 HTTP 请求作为备用');
    const OPENCLAW_API = "http://127.0.0.1:18789";
    const TOKEN = "my-super-secret-token-2025";

    console.log('========== OpenClaw HTTP 消息发送详情 ==========');
    console.log('API 地址:', OPENCLAW_API);
    console.log('Token:', TOKEN);
    console.log('发送的消息:', text);
    console.log('Agent ID:', 'main');
    console.log('Session Key:', 'live2d-pet');
    
    const requestBody = {
      stream: false,
      message: text,
      name: "生活助手",
      sessionKey: "live2d-pet"
    };
    console.log('请求体:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(`${OPENCLAW_API}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'x-openclaw-agent-id': 'main'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('响应状态:', response.status, response.statusText);
    console.log('响应头:', Object.fromEntries(response.headers.entries()));

    if (response.ok) {
      const responseData = await response.json();
      
      // 以 HTML 格式打印响应数据
      console.log('%c========== OpenClaw 响应数据 (HTML 格式) ==========', 'color: #00ff00; font-weight: bold; font-size: 14px;');
      console.log('%c' + formatResponseAsHTML(responseData), 'font-family: monospace; font-size: 12px;');
      
      if (responseData.runId) {
        console.log('%c✅ 成功获取 runId: ' + responseData.runId, 'color: #00ff00; font-weight: bold;');
      } else {
        console.warn('%c⚠️ 响应中没有 runId', 'color: #ffaa00; font-weight: bold;');
      }
      
      console.log('消息发送成功');
    } else {
      const errorText = await response.text();
      console.error('%c❌ 消息发送失败: ' + response.status + ' ' + response.statusText, 'color: #ff0000; font-weight: bold; font-size: 14px;');
      console.error('%c错误响应内容: ' + errorText, 'color: #ff0000; font-family: monospace;');
    }
    console.log('========================================');
  } catch (error) {
    console.error('%c❌ 发送消息到 OpenClaw 失败:', 'color: #ff0000; font-weight: bold; font-size: 14px;');
    console.error('%c错误详情:', 'color: #ff0000;', error);
    console.log('========================================');
  }
}

// 格式化响应数据为 HTML
function formatResponseAsHTML(data: any): string {
  let html = '<div style="background: #f0f0f0; padding: 10px; border-radius: 5px; border: 1px solid #ccc;">';
  
  // runId
  if (data.runId) {
    html += '<div style="margin-bottom: 10px;">';
    html += '<strong style="color: #0066cc;">runId:</strong> ';
    html += '<span style="background: #e6f3ff; padding: 2px 6px; border-radius: 3px; font-family: monospace;">' + data.runId + '</span>';
    html += '</div>';
  }
  
  // status
  if (data.status) {
    html += '<div style="margin-bottom: 10px;">';
    html += '<strong style="color: #0066cc;">status:</strong> ';
    html += '<span style="color: ' + (data.status === 'success' ? '#00aa00' : '#ff6600') + ';">' + data.status + '</span>';
    html += '</div>';
  }
  
  // message
  if (data.message) {
    html += '<div style="margin-bottom: 10px;">';
    html += '<strong style="color: #0066cc;">message:</strong> ';
    html += '<span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px;">' + data.message + '</span>';
    html += '</div>';
  }
  
  // 其他字段
  for (const key in data) {
    if (key !== 'runId' && key !== 'status' && key !== 'message') {
      html += '<div style="margin-bottom: 5px;">';
      html += '<strong style="color: #666;">' + key + ':</strong> ';
      html += '<span style="color: #333;">' + JSON.stringify(data[key]) + '</span>';
      html += '</div>';
    }
  }
  
  html += '</div>';
  return html;
}

// 解析表情标签的函数
function parseEmotionFromText(text: string) {
  const regex = /^\[(\w+)\]\s*(.*)$/;
  const match = text.match(regex);
  
  if (match) {
    return {
      emotion: match[1],
      cleanText: match[2]
    };
  }
  
  return {
    emotion: 'neutral',
    cleanText: text
  };
}

// 文字转语音功能
let currentVoice = 'zh-CN-XiaoxiaoNeural'; // 默认语音

// 处理情感，触发对应表情/动作
function handleEmotion(emotion: string) {
  if (!currentModel) {
    console.warn('没有加载模型，无法触发情感动作');
    return;
  }
  
  console.log('触发情感动作:', emotion);
  
  const emotionMotionMap: Record<string, string> = {
    'excited': 'Action',
    'happy': 'Action',
    'surprised': 'Action',
    'warning': 'Action',
    'neutral': 'Idle'
  };
  
  const motionGroup = emotionMotionMap[emotion.toLowerCase()] || 'Action';
  
  if (typeof (currentModel as any).motion === 'function') {
    (currentModel as any).motion(motionGroup);
    console.log('播放情感动作组:', motionGroup);
  }
}

async function textToSpeech(text: string) {
  try {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 优化语音参数，让声音更萌、更年轻
      utterance.rate = 1.15; // 语速：稍快一点，更活泼
      utterance.pitch = 1.25; // 音调：提高音调，让声音更年轻、更萌
      utterance.volume = 1.0; // 音量：0-1
      
      // 设置语音 - 优先选择更萌的语音
      const voices = window.speechSynthesis.getVoices();
      
      // 优先级顺序：优先选择年轻、可爱的语音
      const preferredVoices = [
        'zh-CN-XiaoxiaoNeural',      // 晓晓 - 年轻女声，最推荐
        'zh-CN-XiaoyiNeural',       // 晓怡 - 年轻女声
        'zh-CN-XiaohanNeural',       // 晓涵 - 年轻女声
        'zh-CN-Xiaoxiao',            // 晓晓（非Neural）
        'zh-CN-YunxiNeural',         // 云希 - 年轻女声
        'zh-CN-XiaoxiaoNeural',      // 重复确保匹配
        'Microsoft Huihui',           // 慧慧 - 中年女声（备用）
        'Microsoft Yaoyao'            // 瑶瑶 - 中年女声（备用）
      ];
      
      let selectedVoice = null;
      for (const voiceName of preferredVoices) {
        selectedVoice = voices.find(voice => 
          voice.name === voiceName || 
          voice.name.includes(voiceName) ||
          voice.lang.includes('zh')
        );
        if (selectedVoice) break;
      }
      
      // 如果没找到，使用第一个中文语音
      if (!selectedVoice) {
        selectedVoice = voices.find(voice => voice.lang.includes('zh'));
      }
      
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log('使用语音:', selectedVoice.name);
        console.log('语音参数 - 语速:', utterance.rate, '音调:', utterance.pitch);
      }
      
      // 播放语音
      window.speechSynthesis.speak(utterance);
      
      // 模拟口型同步
      simulateLipSyncDuringSpeech(utterance);
    } else {
      console.error('浏览器不支持 SpeechSynthesis API');
    }
  } catch (error) {
    console.error('文字转语音错误:', error);
  }
}

// 模拟语音播放时的口型同步
function simulateLipSyncDuringSpeech(utterance: SpeechSynthesisUtterance) {
  if (!currentModel) return;
  
  let animationId: number;
  let isSpeaking = true;
  
  function updateMouth() {
    if (!isSpeaking) {
      // 语音播放完毕，闭嘴
      if (currentModel.internalModel && currentModel.internalModel.coreModel && 
          typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
        currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
      } else if (typeof (currentModel as any).setParamValue === 'function') {
        (currentModel as any).setParamValue('ParamMouthOpenY', 0);
      }
      return;
    }
    
    // 模拟口型张合
    const time = Date.now() / 200;
    const mouthOpen = 0.3 + 0.7 * Math.sin(time) * Math.sin(time * 0.5);
    
    if (currentModel.internalModel && currentModel.internalModel.coreModel && 
        typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
      currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen);
    } else if (typeof (currentModel as any).setParamValue === 'function') {
      (currentModel as any).setParamValue('ParamMouthOpenY', mouthOpen);
    }
    
    animationId = requestAnimationFrame(updateMouth);
  }
  
  // 开始模拟
  updateMouth();
  
  // 语音播放结束时停止模拟
  utterance.onend = () => {
    isSpeaking = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  };
}

// 添加消息到聊天记录
function addMessageToChatLog(sender: 'user' | 'bot', text: string) {
  const chatLog = document.getElementById('chatLog') as HTMLDivElement | null;
  if (!chatLog) return;

  const messageDiv = document.createElement('div');
  messageDiv.style.marginBottom = '8px';
  messageDiv.style.padding = '4px 8px';
  messageDiv.style.borderRadius = '4px';
  
  if (sender === 'user') {
    messageDiv.style.backgroundColor = 'rgba(255,255,255,0.2)';
    messageDiv.style.alignSelf = 'flex-end';
    messageDiv.style.textAlign = 'right';
    messageDiv.textContent = `你: ${text}`;
  } else {
    messageDiv.style.backgroundColor = 'rgba(0,122,255,0.2)';
    messageDiv.style.alignSelf = 'flex-start';
    messageDiv.style.textAlign = 'left';
    messageDiv.textContent = `看板娘: ${text}`;
    
    // 播放机器人回复的语音
    textToSpeech(text);
  }

  chatLog.appendChild(messageDiv);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// 编辑界面相关功能
function setupEditInterface() {
  const editBtn = document.getElementById('editBtn') as HTMLButtonElement | null;
  const editModal = document.getElementById('editModal') as HTMLDivElement | null;
  const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement | null;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement | null;
  const faceSelect = document.getElementById('faceSelect') as HTMLSelectElement | null;
  const actionSelect = document.getElementById('actionSelect') as HTMLSelectElement | null;

  if (!editBtn || !editModal || !cancelBtn || !saveBtn || !faceSelect || !actionSelect) return;

  // 打开编辑界面
  editBtn.addEventListener('click', () => {
    editModal.style.display = 'flex';
    // 加载表情和动作列表
    loadFaceAndActionList();
  });

  // 关闭编辑界面
  cancelBtn.addEventListener('click', () => {
    editModal.style.display = 'none';
  });

  // 保存按钮（暂时功能是关闭弹窗）
  saveBtn.addEventListener('click', () => {
    editModal.style.display = 'none';
  });

  // 点击弹窗外部关闭
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
      editModal.style.display = 'none';
    }
  });

  // 选择表情时自动播放
  faceSelect.addEventListener('change', () => {
    const selectedFace = faceSelect.value;
    if (selectedFace && currentModel && typeof (currentModel as any).motion === 'function') {
      (currentModel as any).motion(selectedFace);
    }
  });

  // 选择动作时自动播放
  actionSelect.addEventListener('change', () => {
    const selectedAction = actionSelect.value;
    if (selectedAction && currentModel && typeof (currentModel as any).motion === 'function') {
      (currentModel as any).motion(selectedAction);
    }
  });

  // 加载表情和动作列表
  async function loadFaceAndActionList() {
    if (!currentModel) {
      console.error('当前没有加载模型');
      faceSelect.innerHTML = '<option value="">请先加载模型</option>';
      actionSelect.innerHTML = '<option value="">请先加载模型</option>';
      return;
    }

    try {
      // 尝试获取当前模型的路径
      const modelPath = (currentModel as any).modelPath || MODEL_OPTIONS[0].path;
      console.log('模型路径:', modelPath);
      if (!modelPath) {
        console.error('无法获取模型路径');
        faceSelect.innerHTML = '<option value="">无法获取模型路径</option>';
        actionSelect.innerHTML = '<option value="">无法获取模型路径</option>';
        return;
      }

      // 加载 model3.json 文件
      console.log('开始加载 model3.json:', modelPath);
      const response = await fetch(modelPath);
      console.log('响应状态:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const modelData = await response.json();
      console.log('模型数据:', JSON.stringify(modelData, null, 2));

      // 清空下拉框
      faceSelect.innerHTML = '';
      actionSelect.innerHTML = '';

      // 加载表情列表
      console.log('Motions:', modelData.Motions);
      console.log('Face data:', modelData.Motions?.Face);
      if (modelData.FileReferences && modelData.FileReferences.Motions && modelData.FileReferences.Motions.Face) {
        console.log('找到表情数据，数量:', modelData.FileReferences.Motions.Face.length);
        modelData.FileReferences.Motions.Face.forEach((face: any) => {
          const option = document.createElement('option');
          option.value = 'Face';
          option.textContent = face.File.split('/').pop()?.replace('.motion3.json', '') || '表情';
          faceSelect.appendChild(option);
        });
      } else {
        console.error('未找到表情数据');
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '无表情数据';
        faceSelect.appendChild(option);
      }

      // 加载动作列表
      console.log('Action data:', modelData.FileReferences?.Motions?.Action);
      if (modelData.FileReferences && modelData.FileReferences.Motions && modelData.FileReferences.Motions.Action) {
        console.log('找到动作数据，数量:', modelData.FileReferences.Motions.Action.length);
        modelData.FileReferences.Motions.Action.forEach((action: any) => {
          const option = document.createElement('option');
          option.value = 'Action';
          option.textContent = action.File.split('/').pop()?.replace('.motion3.json', '') || '动作';
          actionSelect.appendChild(option);
        });
      } else {
        console.error('未找到动作数据');
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '无动作数据';
        actionSelect.appendChild(option);
      }
    } catch (error) {
      console.error('加载表情和动作列表失败:', error);
      // 添加默认选项
      faceSelect.innerHTML = '<option value="">加载失败</option>';
      actionSelect.innerHTML = '<option value="">加载失败</option>';
    }
  }
}

// ============================================================
// 股票监控功能
// ============================================================

// 股票数据缓存
let stockPrices: Record<string, any> = {};
let holdings: any[] = [];
let candidates: any[] = [];
let selectedStockCode: string | null = null;
let alertCooldown: Record<string, number> = {};
let refreshInterval = 10000; // 默认刷新间隔10秒
let refreshTimer: number | null = null; // 刷新定时器
let candidateFilterType: string = 'today'; // 股票池筛选类型: 'today' | 'all'

// 打开股票监控弹窗
function openStockMonitor() {
  const modal = document.getElementById('stockMonitorModal');
  if (modal) {
    modal.style.display = 'flex';
    // 立即刷新数据
    refreshStockData();
  }
}

// 关闭股票监控弹窗
function closeStockMonitor() {
  const modal = document.getElementById('stockMonitorModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 打开添加股票弹窗
function openAddStockModal() {
  const modal = document.getElementById('addStockModal');
  if (modal) {
    // 清空输入
    (document.getElementById('stockCodeInput') as HTMLInputElement).value = '';
    (document.getElementById('stockNameInput') as HTMLInputElement).value = '';
    (document.getElementById('buyPoint1Input') as HTMLInputElement).value = '';
    (document.getElementById('buyPoint2Input') as HTMLInputElement).value = '';
    (document.getElementById('stopLossInput') as HTMLInputElement).value = '';
    (document.getElementById('takeProfitInput') as HTMLInputElement).value = '';
    (document.getElementById('costPriceInput') as HTMLInputElement).value = '';
    (document.getElementById('sharesInput') as HTMLInputElement).value = '';
    modal.style.display = 'flex';
  }
}

// 关闭添加股票弹窗
function closeAddStockModal() {
  const modal = document.getElementById('addStockModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 查询股票信息
async function searchStock(code: string) {
  if (!code || code.length !== 6) {
    alert('请输入6位股票代码');
    return;
  }
  
  const prefix = code.startsWith('6') ? 'sh' : 'sz';
  const url = `http://qt.gtimg.cn/q=${prefix}${code}`;
  
  try {
    const response = await fetch(url);
    // 使用arrayBuffer来正确解码GBK编码
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('GBK').decode(buffer);
    
    const match = text.match(/v_(s[hz]\d{6})="(.+?)";/);
    if (match) {
      const parts = match[2].split('~');
      if (parts.length >= 2) {
        (document.getElementById('stockNameInput') as HTMLInputElement).value = parts[1];
        // 同时填充价格到买点参考
        if (parts.length >= 4) {
          const price = parseFloat(parts[3]);
          if (price) {
            (document.getElementById('buyPoint1Input') as HTMLInputElement).value = (price * 0.98).toFixed(2);
            (document.getElementById('stopLossInput') as HTMLInputElement).value = (price * 0.95).toFixed(2);
            (document.getElementById('costPriceInput') as HTMLInputElement).value = price.toFixed(2);
          }
        }
      }
    }
  } catch (error) {
    console.error('查询股票失败:', error);
    alert('查询失败，请检查网络');
  }
}

// 刷新股票数据
async function refreshStockData() {
  console.log('[股票监控] ========== 开始刷新股票数据 ==========');
  // 更新时间
  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  (document.getElementById('updateTime') as HTMLElement).textContent = timeStr;
  console.log('[股票监控] 更新时间:', timeStr);
  
  // 获取指数数据
  console.log('[股票监控] 开始获取指数数据...');
  await fetchIndexData();
  console.log('[股票监控] 指数数据获取完成');
  
  // 获取股票数据
  console.log('[股票监控] 开始获取股票数据...');
  await fetchStockData();
  console.log('[股票监控] 股票数据获取完成');
  
  // 更新列表
  console.log('[股票监控] holdings数组长度:', holdings.length);
  console.log('[股票监控] candidates数组长度:', candidates.length);
  console.log('[股票监控] stockPrices对象键数量:', Object.keys(stockPrices).length);
  
  console.log('[股票监控] 开始渲染选股池...');
  renderCandidates();
  console.log('[股票监控] 选股池渲染完成');
  
  console.log('[股票监控] 开始渲染持仓...');
  renderHoldings();
  console.log('[股票监控] 持仓渲染完成');
  
  console.log('[股票监控] ========== 刷新股票数据结束 ==========');
}

// 获取指数数据
async function fetchIndexData() {
  try {
    const url = 'http://qt.gtimg.cn/q=sh000001,sz399001,sz399006';
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('GBK').decode(buffer);
    
    const matches = text.match(/v_(s[hz]\d{6})="(.+?)";/g) || [];
    matches.forEach(match => {
      const innerMatch = match.match(/v_(s[hz]\d{6})="(.+?)";/);
      if (innerMatch) {
        const parts = innerMatch[2].split('~');
        if (parts.length >= 4) {
          const code = innerMatch[1];
          const price = parseFloat(parts[3]);
          const change = parseFloat(parts[32]);
          
          if (code === 'sh000001') {
            (document.getElementById('shIndex') as HTMLElement).textContent = price.toFixed(2);
            (document.getElementById('shChange') as HTMLElement).textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
            (document.getElementById('shChange') as HTMLElement).style.color = change >= 0 ? '#ef4444' : '#22c55e';
            (document.getElementById('shIndex') as HTMLElement).style.color = change >= 0 ? '#ef4444' : '#22c55e';
          } else if (code === 'sz399001') {
            (document.getElementById('szIndex') as HTMLElement).textContent = price.toFixed(2);
            (document.getElementById('szChange') as HTMLElement).textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
            (document.getElementById('szChange') as HTMLElement).style.color = change >= 0 ? '#22c55e' : '#ef4444';
            (document.getElementById('szIndex') as HTMLElement).style.color = change >= 0 ? '#22c55e' : '#ef4444';
          } else if (code === 'sz399006') {
            (document.getElementById('cyIndex') as HTMLElement).textContent = price.toFixed(2);
            (document.getElementById('cyChange') as HTMLElement).textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
            (document.getElementById('cyChange') as HTMLElement).style.color = change >= 0 ? '#3b82f6' : '#ef4444';
            (document.getElementById('cyIndex') as HTMLElement).style.color = change >= 0 ? '#3b82f6' : '#ef4444';
          }
        }
      }
    });
  } catch (error) {
    console.error('获取指数数据失败:', error);
  }
}

// 从后端API获取持仓数据
async function fetchHoldingsFromAPI(): Promise<void> {
  try {
    console.log('[股票监控] 开始调用API: /api/holdings');
    const response = await fetch('http://127.0.0.1:8765/api/holdings');
    console.log('[股票监控] API响应状态:', response.status);
    const result = await response.json();
    console.log('[股票监控] API返回数据:', JSON.stringify(result));
    if (result.data) {
      // 过滤出当前持仓（status为'当前持仓'或未设置的）
      holdings = result.data.filter((h: any) => h.status !== '已卖出').map((h: any) => ({
        code: h.code,
        name: h.name,
        cost: h.cost || h.buy_price,
        shares: h.shares,
        stop_loss: h.stop_loss,
        take_profit: h.take_profit,
        status: h.status || 'holding'
      }));
      console.log('[股票监控] 从API获取持仓:', holdings.length, '只');
      console.log('[股票监控] 持仓详情:', JSON.stringify(holdings));
    } else {
      console.log('[股票监控] API返回数据为空');
    }
  } catch (error) {
    console.error('[股票监控] 获取持仓失败:', error);
    console.error('[股票监控] 错误详情:', (error as Error).message);
  }
}

// 从后端API获取选股池数据
async function fetchCandidatesFromAPI(filter: string = 'today'): Promise<void> {
  try {
    console.log('[股票监控] 开始调用API: /api/candidates, 筛选类型:', filter);
    const url = filter === 'all' ? 'http://127.0.0.1:8765/api/candidates?filter=all' : 'http://127.0.0.1:8765/api/candidates';
    const response = await fetch(url);
    console.log('[股票监控] API响应状态:', response.status);
    const result = await response.json();
    console.log('[股票监控] API返回数据:', JSON.stringify(result));
    if (result.data) {
      candidates = result.data.map((c: any) => ({
        code: c.code,
        name: c.name,
        buy_point_1: c.buy_point_1,
        buy_point_2: c.buy_point_2,
        stop_loss: c.stop_loss,
        take_profit: c.take_profit,
        notes: c.notes,
        date: c.date
      }));
      console.log('[股票监控] 从API获取选股池:', candidates.length, '只, 筛选类型:', filter);
    } else {
      console.log('[股票监控] API返回数据为空');
    }
  } catch (error) {
    console.error('[股票监控] 获取选股池失败:', error);
    console.error('[股票监控] 错误详情:', (error as Error).message);
  }
}

// 获取股票实时数据
async function fetchStockData() {
  // 先从API获取持仓和选股池数据
  await fetchHoldingsFromAPI();
  await fetchCandidatesFromAPI(candidateFilterType);
  
  const allCodes: string[] = [];
  
  // 收集代码（带前缀）
  holdings.forEach(h => {
    const prefix = h.code.startsWith('6') ? 'sh' : 'sz';
    allCodes.push(`${prefix}${h.code}`);
  });
  
  candidates.forEach(c => {
    const prefix = c.code.startsWith('6') ? 'sh' : 'sz';
    allCodes.push(`${prefix}${c.code}`);
  });
  
  if (allCodes.length === 0) {
    console.log('[股票监控] 没有股票数据需要获取');
    return;
  }
  
  console.log('[股票监控] 正在获取', allCodes.length, '只股票数据...');
  
  try {
    const url = `http://qt.gtimg.cn/q=${allCodes.join(',')}`;
    console.log('[股票监控] 请求URL:', url);
    
    const response = await fetch(url);
    console.log('[股票监控] 响应状态:', response.status);
    
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('GBK').decode(buffer);
    console.log('[股票监控] 响应长度:', text.length, '字符');
    
    // 使用临时对象存储新数据，避免清空旧数据
    const newStockPrices: Record<string, any> = {};
    const matches = text.match(/v_(s[hz]\d{6})="(.+?)";/g) || [];
    
    console.log('[股票监控] 解析到', matches.length, '条股票数据');
    
    matches.forEach(match => {
      const innerMatch = match.match(/v_(s[hz]\d{6})="(.+?)";/);
      if (innerMatch) {
        const parts = innerMatch[2].split('~');
        if (parts.length >= 40) {
          const code = parts[2]; // 不带前缀的股票代码
          newStockPrices[code] = {
            name: parts[1],
            price: parseFloat(parts[3]) || 0,
            prevClose: parseFloat(parts[4]) || 0,
            change: parseFloat(parts[32]) || 0,
            high: parseFloat(parts[33]) || 0,
            low: parseFloat(parts[34]) || 0,
            turnover: parseFloat(parts[38]) || 0,
            volumeRatio: parseFloat(parts[49]) || 0,
          };
          console.log('[股票监控]', code, '-', parts[1], '- 现价:', parts[3], '- 涨幅:', parts[32]);
        }
      }
    });
    
    // 只有成功获取到数据时才更新缓存
    if (Object.keys(newStockPrices).length > 0) {
      stockPrices = newStockPrices;
      console.log('[股票监控] 成功更新', Object.keys(stockPrices).length, '只股票数据');
    } else {
      console.warn('[股票监控] 未获取到有效数据，保留缓存');
    }
    
  } catch (error) {
    console.error('[股票监控] 获取数据失败:', error);
    // 失败时不清除原有数据
  }
}

// 渲染选股池
function renderCandidates() {
  const container = document.getElementById('candidateList');
  if (!container) return;
  
  if (candidates.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">暂无选股数据</div>';
    (document.getElementById('candidateCount') as HTMLElement).textContent = '(0只)';
    return;
  }
  
  (document.getElementById('candidateCount') as HTMLElement).textContent = `(${candidates.length}只)`;
  
  container.innerHTML = candidates.map(c => {
    const price = stockPrices[c.code]?.price || 0;
    const change = stockPrices[c.code]?.change || 0;
    const bp1 = c.buy_point_1 || 0;
    const bp2 = c.buy_point_2 || 0;
    const sl = c.stop_loss || 0;
    
    // 计算距离买点的百分比
    let dist1 = 0;
    if (bp1 > 0) {
      dist1 = ((price - bp1) / bp1 * 100);
    }
    
    // 状态灯判断（按优先级排序）
    let statusLight = '⚪';
    let alertClass = '';
    let isLimitUp = change >= 9.9; // 涨停判断
    
    // 检查涨停状态
    if (isLimitUp) {
      statusLight = '🔒';
    } else if (sl > 0 && price <= sl) {
      statusLight = '🔴';
      alertClass = 'alert-danger';
    } else if (price <= bp1 * 1.01 && bp1 > 0) {
      statusLight = '🟢';
      alertClass = 'alert-success';
      // 触发买点告警
      checkCandidateAlert(c, price);
    } else if (bp2 > 0 && bp1 > 0 && price > bp1 && price <= bp2) {
      statusLight = '🟡';
    }
    
    const isSelected = selectedStockCode === c.code;
    
    return `
      <div class="stock-row ${alertClass} ${isSelected ? 'selected' : ''}" onclick="selectStock('${c.code}')" data-code="${c.code}" data-type="candidate">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 14px;">${statusLight}</span>
            <span style="color: #fff; font-size: 14px; font-weight: 500;">${c.name}</span>
            <span style="color: rgba(255,255,255,0.5); font-size: 12px;">(${c.code})</span>
            ${isLimitUp ? '<span style="color: #ef4444; font-size: 12px; font-weight: bold;">涨停</span>' : ''}
          </div>
          <div style="text-align: right;">
            <span style="color: ${change >= 0 ? '#ef4444' : '#22c55e'}; font-size: 14px; font-weight: 600;">${price.toFixed(2)}</span>
            <span style="color: ${change >= 0 ? '#ef4444' : '#22c55e'}; font-size: 12px; margin-left: 4px;">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>
          </div>
        </div>
        <div style="margin-top: 4px; font-size: 12px; color: rgba(255,255,255,0.6);">
          买点1 ${bp1.toFixed(2)} (${dist1 >= 0 ? '+' : ''}${dist1.toFixed(1)}%)
          ${bp2 > 0 ? `| 买点2 ${bp2.toFixed(2)}` : ''}
          ${sl > 0 ? `| 🛑${sl.toFixed(2)}` : ''}
          ${c.take_profit ? `| 🎳${c.take_profit}` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 渲染持仓列表
function renderHoldings() {
  const container = document.getElementById('holdingList');
  if (!container) return;
  
  console.log('[股票监控] renderHoldings - holdings数组长度:', holdings.length);
  console.log('[股票监控] renderHoldings - holdings数据:', JSON.stringify(holdings));
  
  // 只显示持仓状态的股票（status为'holding'或未设置或'当前持仓'）
  const holdingStocks = holdings.filter(h => h.status !== 'sold' && h.status !== '已卖出');
  console.log('[股票监控] renderHoldings - 过滤后持仓数量:', holdingStocks.length);
  
  if (holdingStocks.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">暂无持仓数据</div>';
    (document.getElementById('holdingCount') as HTMLElement).textContent = '(0只)';
    return;
  }
  
  (document.getElementById('holdingCount') as HTMLElement).textContent = `(${holdingStocks.length}只)`;
  
  // 计算汇总
  let totalMarketValue = 0;
  let totalProfit = 0;
  let totalCost = 0;
  
  const html = holdingStocks.map(h => {
    const price = stockPrices[h.code]?.price || 0;
    const change = stockPrices[h.code]?.change || 0;
    const sl = h.stop_loss || 0;
    const tpStr = h.take_profit || '';
    const tpParts = tpStr.split('/');
    const tp1 = parseFloat(tpParts[0]) || 0;
    
    const pnl = ((price - h.cost) / h.cost * 100);
    const pnlAmount = (price - h.cost) * (h.shares || 0);
    
    totalMarketValue += price * (h.shares || 0);
    totalCost += h.cost * (h.shares || 0);
    totalProfit += pnlAmount;
    
    // 状态灯判断（按优先级排序）
    let statusLight = '🔵';
    let alertClass = '';
    let isBigUp = change >= 5;
    
    // 止损触发（最高优先级）
    if (sl > 0 && price <= sl) {
      statusLight = '🔴';
      alertClass = 'alert-danger';
      checkHoldingAlert(h, price, 'stop_loss');
    } 
    // 止损逼近
    else if (sl > 0 && price <= sl * 1.03) {
      statusLight = '🟠';
      alertClass = 'alert-warning';
      checkHoldingAlert(h, price, 'stop_loss_near');
    } 
    // 止盈达成
    else if (tp1 > 0 && price >= tp1) {
      statusLight = '🟢';
      alertClass = 'alert-success';
      checkHoldingAlert(h, price, 'take_profit');
    }
    // 大涨提醒（紫色）
    else if (isBigUp) {
      statusLight = '🟣';
      alertClass = 'alert-purple';
      checkHoldingAlert(h, price, 'big_up');
    }
    
    const isSelected = selectedStockCode === h.code;
    
    return `
      <div class="stock-row ${alertClass} ${isSelected ? 'selected' : ''}" onclick="selectStock('${h.code}')" data-code="${h.code}" data-type="holding">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 14px;">${statusLight}</span>
            <span style="color: #fff; font-size: 14px; font-weight: 500;">${h.name}</span>
            <span style="color: rgba(255,255,255,0.5); font-size: 12px;">(${h.code})</span>
            ${isBigUp ? '<span style="color: #a855f7; font-size: 12px; font-weight: bold;">大涨</span>' : ''}
          </div>
          <div style="text-align: right;">
            <span style="color: ${change >= 0 ? '#ef4444' : '#22c55e'}; font-size: 14px; font-weight: 600;">${price.toFixed(2)}</span>
            <span style="color: ${pnl >= 0 ? '#ef4444' : '#22c55e'}; font-size: 12px; margin-left: 8px;">${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</span>
          </div>
        </div>
        <div style="margin-top: 4px; font-size: 12px; color: rgba(255,255,255,0.6);">
          成本 ${h.cost.toFixed(2)}
          ${sl > 0 ? `| 🛑${sl.toFixed(2)}` : ''}
          ${tp1 > 0 ? `| 🎳${tp1.toFixed(2)}` : ''}
          ${h.shares > 0 ? `| ${h.shares}股` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
  
  // 更新汇总栏
  const todayChange = ((totalMarketValue - totalCost) / totalCost * 100);
  (document.getElementById('holdingSummary') as HTMLElement).innerHTML = `
    <div style="display: flex; justify-content: space-between;">
      <div style="display: flex; gap: 24px;">
        <span style="color: rgba(255,255,255,0.6); font-size: 12px;">总持仓:</span>
        <span style="color: #fff; font-size: 12px; font-weight: 600;">${holdingStocks.length}只</span>
      </div>
      <div style="display: flex; gap: 24px;">
        <span style="color: rgba(255,255,255,0.6); font-size: 12px;">总市值:</span>
        <span style="color: #fff; font-size: 12px; font-weight: 600;">¥${totalMarketValue.toLocaleString()}</span>
      </div>
      <div style="display: flex; gap: 24px;">
        <span style="color: rgba(255,255,255,0.6); font-size: 12px;">今日浮盈:</span>
        <span style="color: ${totalProfit >= 0 ? '#ef4444' : '#22c55e'}; font-size: 12px; font-weight: 600;">${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)} (${todayChange >= 0 ? '+' : ''}${todayChange.toFixed(2)}%)</span>
      </div>
    </div>
  `;
}

// 检查选股池告警
function checkCandidateAlert(c: any, price: number) {
  const bp1 = c.buy_point_1 || 0;
  const now = Date.now();
  
  if (price <= bp1 * 1.01 && bp1 > 0) {
    const key = `candidate_${c.code}`;
    if (!alertCooldown[key] || now - alertCooldown[key] > 300000) { // 5分钟冷却
      alertCooldown[key] = now;
      const msg = `翔爷，${c.name}(${c.code}) 触及第一买点了！现价${price.toFixed(2)}，买点${bp1.toFixed(2)}，要买么？`;
      speakAlert(msg);
      // 显示到气泡
      if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
        window.writerInstance.type(msg);
      }
    }
  }
}

// 检查持仓告警
function checkHoldingAlert(h: any, price: number, type: string) {
  const now = Date.now();
  const key = `holding_${h.code}_${type}`;
  
  if (alertCooldown[key] && now - alertCooldown[key] <= 300000) {
    return; // 冷却中
  }
  
  alertCooldown[key] = now;
  let msg = '';
  
  switch (type) {
    case 'stop_loss':
      msg = `翔爷，你持仓的${h.name}跌破止损价了！现价${price.toFixed(2)}，止损${h.stop_loss.toFixed(2)}，需要止损么？`;
      break;
    case 'stop_loss_near':
      const dist = ((price - h.stop_loss) / h.stop_loss * 100);
      msg = `翔爷，${h.name}逼近止损线！现价${price.toFixed(2)}，距止损仅${dist.toFixed(1)}%，注意风险！`;
      break;
    case 'take_profit':
      const pnl = ((price - h.cost) / h.cost * 100);
      msg = `翔爷，${h.name}止盈达成！现价${price.toFixed(2)}，浮盈${pnl.toFixed(1)}%，需要止盈么？`;
      break;
    case 'big_up':
      const change = stockPrices[h.code]?.change || 0;
      msg = `翔爷，${h.name}大涨${change.toFixed(1)}%！现价${price.toFixed(2)}，要不要减仓？`;
      break;
  }
  
  if (msg) {
    speakAlert(msg);
    // 显示到气泡
    if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
      window.writerInstance.type(msg);
    }
  }
}

// TTS语音播报
function speakAlert(text: string) {
  if (!('speechSynthesis' in window)) {
    console.warn('浏览器不支持语音合成');
    return;
  }
  
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 1.2;
  utter.pitch = 1.0;
  
  const voices = synth.getVoices();
  const selectedVoice = voices.find(v => v.name.includes('Xiaoxiao')) || voices.find(v => v.lang.includes('zh')) || voices[0];
  if (selectedVoice) {
    utter.voice = selectedVoice;
  }
  
  synth.speak(utter);
}

// 选择股票
function selectStock(code: string) {
  selectedStockCode = selectedStockCode === code ? null : code;
  renderCandidates();
  renderHoldings();
}

// 删除选股池股票
async function deleteCandidate() {
  if (!selectedStockCode) {
    alert('请先选中要删除的股票');
    return;
  }
  
  const index = candidates.findIndex(c => c.code === selectedStockCode);
  if (index !== -1) {
    const stock = candidates[index];
    if (confirm(`确定要删除 ${stock.name}(${stock.code}) 吗？`)) {
      try {
        const response = await fetch('http://127.0.0.1:8765/api/delete_stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: stock.code, table: 'stock_pool' })
        });
        const result = await response.json();
        if (result.success) {
          // 从本地数组移除
          candidates.splice(index, 1);
          selectedStockCode = null;
          renderCandidates();
          alert('删除成功！');
        } else {
          alert('删除失败: ' + (result.error || '未知错误'));
        }
      } catch (error) {
        console.error('[股票监控] 删除股票失败:', error);
        alert('删除失败: 网络错误');
      }
    }
  }
}

// 卖出持仓股票
function sellHolding() {
  if (!selectedStockCode) {
    alert('请先选中要卖出的股票');
    return;
  }
  
  const index = holdings.findIndex(h => h.code === selectedStockCode);
  if (index !== -1) {
    const stock = holdings[index];
    const currentPrice = stockPrices[stock.code]?.price || stock.cost;
    
    // 打开卖出弹窗
    const sellModal = document.getElementById('sellStockModal');
    if (sellModal) {
      // 设置默认卖出价格为当前价格
      (document.getElementById('sellPriceInput') as HTMLInputElement).value = currentPrice.toFixed(2);
      (document.getElementById('sellStockName') as HTMLElement).textContent = `${stock.name}(${stock.code})`;
      (document.getElementById('sellStockCost') as HTMLElement).textContent = stock.cost.toFixed(2);
      (document.getElementById('sellStockShares') as HTMLElement).textContent = stock.shares.toString();
      sellModal.style.display = 'flex';
    }
  }
}

// 确认卖出
async function confirmSellStock() {
  const sellPrice = parseFloat((document.getElementById('sellPriceInput') as HTMLInputElement).value);
  const stockName = (document.getElementById('sellStockName') as HTMLElement).textContent || '';
  const code = stockName.match(/\((\d{6})\)/)?.[1] || '';
  
  if (!code) {
    alert('无法获取股票代码');
    return;
  }
  
  if (isNaN(sellPrice) || sellPrice <= 0) {
    alert('请输入有效的卖出价格');
    return;
  }
  
  const index = holdings.findIndex(h => h.code === code);
  if (index !== -1) {
    const stock = holdings[index];
    const profit = (sellPrice - stock.cost) * stock.shares;
    const profitPercent = ((sellPrice - stock.cost) / stock.cost * 100);
    
    if (confirm(`确认卖出 ${stock.name}(${stock.code})？\n卖出价格: ¥${sellPrice.toFixed(2)}\n持仓成本: ¥${stock.cost.toFixed(2)}\n持仓数量: ${stock.shares}股\n预计收益: ${profit >= 0 ? '+' : ''}¥${profit.toFixed(2)} (${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`)) {
      try {
        const response = await fetch('http://127.0.0.1:8765/api/delete_stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: stock.code, table: 'holdings' })
        });
        const result = await response.json();
        if (result.success) {
          // 从本地持仓列表移除（因为已卖出）
          holdings.splice(index, 1);
          selectedStockCode = null;
          closeSellModal();
          renderHoldings();
          alert(`卖出成功！\n收益: ${profit >= 0 ? '+' : ''}¥${profit.toFixed(2)}`);
        } else {
          alert('卖出失败: ' + (result.error || '未知错误'));
        }
      } catch (error) {
        console.error('[股票监控] 卖出失败:', error);
        alert('卖出失败: 网络错误');
      }
    }
  }
}

// 关闭卖出弹窗
function closeSellModal() {
  const sellModal = document.getElementById('sellStockModal');
  if (sellModal) {
    sellModal.style.display = 'none';
  }
}

// 确认添加股票
async function confirmAddStock() {
  const code = (document.getElementById('stockCodeInput') as HTMLInputElement).value.trim();
  const name = (document.getElementById('stockNameInput') as HTMLInputElement).value.trim();
  const bp1 = parseFloat((document.getElementById('buyPoint1Input') as HTMLInputElement).value);
  const bp2 = parseFloat((document.getElementById('buyPoint2Input') as HTMLInputElement).value);
  const sl = parseFloat((document.getElementById('stopLossInput') as HTMLInputElement).value);
  const tp = (document.getElementById('takeProfitInput') as HTMLInputElement).value.trim();
  const cost = parseFloat((document.getElementById('costPriceInput') as HTMLInputElement).value);
  const shares = parseInt((document.getElementById('sharesInput') as HTMLInputElement).value);
  
  if (!code || code.length !== 6) {
    alert('请输入有效的6位股票代码');
    return;
  }
  
  if (!name) {
    alert('请先查询股票名称');
    return;
  }
  
  try {
    const response = await fetch('http://127.0.0.1:8765/api/add_stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        name,
        buy_point_1: bp1 || 0,
        buy_point_2: bp2 || 0,
        stop_loss: sl || 0,
        take_profit: tp,
        cost,
        shares
      })
    });
    const result = await response.json();
    if (result.success) {
      alert('添加成功！');
      closeAddStockModal();
      // 刷新数据
      await fetchHoldingsFromAPI();
      await fetchCandidatesFromAPI();
      renderHoldings();
      renderCandidates();
    } else {
      alert('添加失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    console.error('[股票监控] 添加股票失败:', error);
    alert('添加失败: 网络错误');
  }
}

// 初始化股票监控
function initStockMonitor() {
  // 绑定按钮事件
  const stockMonitorBtn = document.getElementById('stockMonitorBtn');
  if (stockMonitorBtn) {
    stockMonitorBtn.addEventListener('click', openStockMonitor);
  }
  
  const closeStockModalBtn = document.getElementById('closeStockModalBtn');
  if (closeStockModalBtn) {
    closeStockModalBtn.addEventListener('click', closeStockMonitor);
  }
  
  // 点击弹窗外部关闭
  const stockMonitorModal = document.getElementById('stockMonitorModal');
  if (stockMonitorModal) {
    stockMonitorModal.addEventListener('click', (e) => {
      if (e.target === stockMonitorModal) {
        closeStockMonitor();
      }
    });
  }
  
  // 添加股票相关
  const addCandidateBtn = document.getElementById('addCandidateBtn');
  const addHoldingBtn = document.getElementById('addHoldingBtn');
  if (addCandidateBtn) addCandidateBtn.addEventListener('click', openAddStockModal);
  if (addHoldingBtn) addHoldingBtn.addEventListener('click', openAddStockModal);
  
  // 删除股票相关
  const delCandidateBtn = document.getElementById('delCandidateBtn');
  const delHoldingBtn = document.getElementById('delHoldingBtn');
  if (delCandidateBtn) delCandidateBtn.addEventListener('click', deleteCandidate);
  if (delHoldingBtn) delHoldingBtn.addEventListener('click', sellHolding);
  
  const cancelAddBtn = document.getElementById('cancelAddBtn');
  if (cancelAddBtn) cancelAddBtn.addEventListener('click', closeAddStockModal);
  
  const confirmAddBtn = document.getElementById('confirmAddBtn');
  if (confirmAddBtn) confirmAddBtn.addEventListener('click', confirmAddStock);
  
  const searchStockBtn = document.getElementById('searchStockBtn');
  if (searchStockBtn) {
    searchStockBtn.addEventListener('click', () => {
      const code = (document.getElementById('stockCodeInput') as HTMLInputElement).value.trim();
      searchStock(code);
    });
  }
  
  // 输入代码后自动查询
  const stockCodeInput = document.getElementById('stockCodeInput') as HTMLInputElement;
  if (stockCodeInput) {
    stockCodeInput.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.value.length === 6) {
        searchStock(target.value);
      }
    });
  }
  
  // 添加股票弹窗外部点击关闭
  const addStockModal = document.getElementById('addStockModal');
  if (addStockModal) {
    addStockModal.addEventListener('click', (e) => {
      if (e.target === addStockModal) {
        closeAddStockModal();
      }
    });
  }
  
  // 暴露全局函数供HTML使用
  (window as any).selectStock = selectStock;
  (window as any).closeSellModal = closeSellModal;
  
  // 手动刷新按钮
  const refreshStockBtn = document.getElementById('refreshStockBtn');
  if (refreshStockBtn) {
    refreshStockBtn.addEventListener('click', () => {
      console.log('[股票监控] 用户手动触发刷新');
      refreshStockData();
    });
  }
  
  // 选股池刷新按钮（从数据库刷新）
  const refreshCandidateBtn = document.getElementById('refreshCandidateBtn');
  if (refreshCandidateBtn) {
    refreshCandidateBtn.addEventListener('click', () => {
      console.log('[股票监控] 刷新选股池数据');
      refreshCandidatePool();
    });
  }
  
  // 股票池筛选下拉框
  const candidateFilter = document.getElementById('candidateFilter');
  if (candidateFilter) {
    candidateFilter.addEventListener('change', changeCandidateFilter);
  }
  
  // Alpha选股按钮
  const alphaScanBtn = document.getElementById('alphaScanBtn');
  if (alphaScanBtn) {
    alphaScanBtn.addEventListener('click', openAlphaScanModal);
  }
  
  // Alpha选股弹窗关闭按钮
  const closeAlphaModalBtn = document.getElementById('closeAlphaModalBtn');
  if (closeAlphaModalBtn) {
    closeAlphaModalBtn.addEventListener('click', closeAlphaScanModal);
  }
  
  // Alpha选股开始扫描按钮
  const startAlphaScanBtn = document.getElementById('startAlphaScanBtn');
  if (startAlphaScanBtn) {
    startAlphaScanBtn.addEventListener('click', executeAlphaScan);
  }
  
  // Alpha选股弹窗外部点击关闭
  const alphaScanModal = document.getElementById('alphaScanModal');
  if (alphaScanModal) {
    alphaScanModal.addEventListener('click', (e) => {
      if (e.target === alphaScanModal) {
        closeAlphaScanModal();
      }
    });
  }
  
  // 卖出确认按钮
  const confirmSellBtn = document.getElementById('confirmSellBtn');
  if (confirmSellBtn) {
    confirmSellBtn.addEventListener('click', confirmSellStock);
  }
  
  // 卖出弹窗外部点击关闭
  const sellStockModal = document.getElementById('sellStockModal');
  if (sellStockModal) {
    sellStockModal.addEventListener('click', (e) => {
      if (e.target === sellStockModal) {
        closeSellModal();
      }
    });
  }
  
  // 刷新间隔选择器（仅记录值，不自动应用）
  const refreshIntervalSelect = document.getElementById('refreshIntervalSelect') as HTMLSelectElement;
  
  // 刷新间隔确认按钮
  const confirmIntervalBtn = document.getElementById('confirmIntervalBtn');
  if (confirmIntervalBtn) {
    confirmIntervalBtn.addEventListener('click', () => {
      if (refreshIntervalSelect) {
        const newInterval = parseInt(refreshIntervalSelect.value);
        console.log('[股票监控] 刷新间隔变更为:', newInterval / 1000, '秒');
        refreshInterval = newInterval;
        // 重启定时器
        startRefreshTimer();
        alert(`刷新间隔已设置为 ${newInterval / 1000} 秒`);
      }
    });
  }
  
  // 启动定时刷新
  startRefreshTimer();
}

// 启动/重启定时刷新
function startRefreshTimer() {
  // 清除旧定时器
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  // 启动新定时器
  refreshTimer = window.setInterval(() => {
    const modal = document.getElementById('stockMonitorModal');
    if (modal && modal.style.display === 'flex') {
      refreshStockData();
    }
  }, refreshInterval);
}

// 刷新选股池（从后端API刷新）
async function refreshCandidatePool() {
  console.log('[股票监控] 刷新选股池 - 从API获取最新数据, 筛选类型:', candidateFilterType);
  
  // 从API刷新选股池数据（使用当前筛选类型）
  await fetchCandidatesFromAPI(candidateFilterType);
  
  // 同时刷新持仓数据
  await fetchHoldingsFromAPI();
  
  // 刷新界面
  renderCandidates();
  renderHoldings();
  
  alert(`选股池已刷新！\n选股池: ${candidates.length}只\n持仓: ${holdings.length}只`);
}

// 切换股票池筛选
async function changeCandidateFilter() {
  const select = document.getElementById('candidateFilter') as HTMLSelectElement;
  if (select) {
    candidateFilterType = select.value;
    console.log('[股票监控] 股票池筛选类型切换为:', candidateFilterType);
    await refreshCandidatePool();
  }
}

// Alpha选股功能
let alphaScanResults: any[] = [];

// 打开Alpha选股弹窗
function openAlphaScanModal() {
  const modal = document.getElementById('alphaScanModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// 关闭Alpha选股弹窗
function closeAlphaScanModal() {
  const modal = document.getElementById('alphaScanModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 执行Alpha选股扫描
async function executeAlphaScan() {
  console.log('[Alpha选股] 开始执行选股扫描...');
  
  const resultList = document.getElementById('alphaResultList');
  const resultCount = document.getElementById('alphaResultCount');
  const scanBtn = document.getElementById('startAlphaScanBtn') as HTMLButtonElement;
  
  if (scanBtn) {
    scanBtn.innerHTML = '扫描中...';
    scanBtn.disabled = true;
  }
  
  if (resultList) {
    resultList.innerHTML = `
      <div style="text-align: center; color: rgba(255,255,255,0.6); padding: 40px 0;">
        <div style="font-size: 32px; margin-bottom: 12px;">搜索</div>
        <div>正在扫描A股市场...</div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 8px;">此过程可能需要10-30秒</div>
      </div>
    `;
  }
  
  try {
    console.log('[Alpha选股] 开始调用API: /api/alpha_scan');
    const response = await fetch('http://127.0.0.1:8765/api/alpha_scan');
    console.log('[Alpha选股] API响应状态:', response.status);
    console.log('[Alpha选股] API响应状态文本:', response.statusText);
    
    const result = await response.json();
    console.log('[Alpha选股] API返回数据:', JSON.stringify(result, null, 2));
    
    if (result['推荐']) {
      console.log('[Alpha选股] 发现推荐字段，长度:', result['推荐'].length);
      alphaScanResults = result['推荐'];
      console.log('[Alpha选股] 准备渲染结果...');
      renderAlphaResults(alphaScanResults);
      if (resultCount) {
        resultCount.innerHTML = alphaScanResults.length + '只';
        console.log('[Alpha选股] 更新结果数量:', alphaScanResults.length + '只');
      }
      console.log('[Alpha选股] 扫描完成，找到 ' + alphaScanResults.length + ' 只股票');
    } else if (result['error']) {
      console.error('[Alpha选股] API返回错误:', result['error']);
      if (resultList) {
        resultList.innerHTML = `
          <div style="text-align: center; color: rgba(239,68,68,0.8); padding: 40px 0;">
            <div style="font-size: 32px; margin-bottom: 12px;">❌</div>
            <div>扫描失败: ${result['error']}</div>
          </div>
        `;
      }
    } else {
      console.log('[Alpha选股] 未找到推荐字段，返回数据:', JSON.stringify(result));
      if (resultList) {
        resultList.innerHTML = `
          <div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">
            <div style="font-size: 32px; margin-bottom: 12px;">😔</div>
            <div>未找到符合条件的股票</div>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[Alpha选股] 扫描失败:', error);
    console.error('[Alpha选股] 错误详情:', (error as Error).message);
    if (resultList) {
      resultList.innerHTML = `
        <div style="text-align: center; color: rgba(239,68,68,0.8); padding: 40px 0;">
          <div style="font-size: 32px; margin-bottom: 12px;">❌</div>
          <div>扫描失败，请检查后端服务</div>
        </div>
      `;
    }
  } finally {
    console.log('[Alpha选股] finally块执行');
    if (scanBtn) {
      scanBtn.innerHTML = '开始扫描';
      scanBtn.disabled = false;
      console.log('[Alpha选股] 按钮状态已重置');
    }
  }
}

// 渲染Alpha选股结果
function renderAlphaResults(results: any[]) {
  const resultList = document.getElementById('alphaResultList');
  if (!resultList) return;
  
  if (results.length === 0) {
    resultList.innerHTML = `
      <div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">
        <div style="font-size: 32px; margin-bottom: 12px;">😔</div>
        <div>未找到符合条件的股票</div>
      </div>
    `;
    return;
  }
  
  resultList.innerHTML = results.map((stock, index) => `
    <div 
      style="padding: 10px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; transition: all 0.2s; border-left: 3px solid ${getScoreColor(stock.评分)};"
      onclick="selectAlphaStock(${index})"
    >
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <span style="color: #fff; font-size: 13px; font-weight: 600;">${stock.名称}</span>
        <span style="color: ${stock.涨幅 >= 0 ? '#22c55e' : '#ef4444'}; font-size: 12px;">${stock.涨幅 >= 0 ? '+' : ''}${stock.涨幅.toFixed(2)}%</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="color: rgba(255,255,255,0.5); font-size: 11px;">${stock.代码}</span>
        <span style="color: ${getScoreColor(stock.评分)}; font-size: 11px; font-weight: 600;">评分: ${stock.评分}</span>
      </div>
      <div style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">
        ${stock.条件.slice(0, 3).map((cond: string) => `
          <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7);">${cond}</span>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// 获取评分颜色
function getScoreColor(score: number): string {
  if (score >= 30) return '#22c55e';
  if (score >= 15) return '#fbbf24';
  if (score >= 0) return '#60a5fa';
  return '#ef4444';
}

// 选择Alpha选股结果
function selectAlphaStock(index: number) {
  const stock = alphaScanResults[index];
  if (!stock) return;
  
  const detailPanel = document.getElementById('alphaDetailPanel');
  if (!detailPanel) return;
  
  // 生成条件标签HTML
  const conditionTags = stock.条件.map((cond: string) => {
    let bgColor = 'rgba(255,255,255,0.1)';
    let textColor = 'rgba(255,255,255,0.8)';
    if (cond.includes('✅')) {
      bgColor = 'rgba(34,197,94,0.2)';
      textColor = '#22c55e';
    } else if (cond.includes('⚠️')) {
      bgColor = 'rgba(239,68,68,0.2)';
      textColor = '#ef4444';
    }
    return `<span style="font-size: 12px; padding: 4px 10px; border-radius: 6px; background: ${bgColor}; color: ${textColor};">${cond}</span>`;
  }).join('');
  
  const changeColor = stock.涨幅 >= 0 ? '#22c55e' : '#ef4444';
  const changeSign = stock.涨幅 >= 0 ? '+' : '';
  const evColor = stock.EV >= 0 ? '#22c55e' : '#ef4444';
  const evSign = stock.EV >= 0 ? '+' : '';
  const scoreColor = getScoreColor(stock.评分);
  
  detailPanel.innerHTML = `
    <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <h3 style="color: #fff; font-size: 18px; font-weight: 600; margin-bottom: 4px;">${stock.名称}</h3>
          <span style="color: rgba(255,255,255,0.6); font-size: 12px;">${stock.代码}</span>
        </div>
        <div style="text-align: right;">
          <div style="color: #fff; font-size: 24px; font-weight: 600;">¥${stock.现价.toFixed(2)}</div>
          <div style="color: ${changeColor}; font-size: 14px;">${changeSign}${stock.涨幅.toFixed(2)}%</div>
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">流通市值</div>
          <div style="color: #fff; font-size: 13px; font-weight: 600;">${stock.流通市值亿.toFixed(1)}亿</div>
        </div>
        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">换手率</div>
          <div style="color: #fff; font-size: 13px; font-weight: 600;">${stock.换手率.toFixed(2)}%</div>
        </div>
        <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">EV期望值</div>
          <div style="color: ${evColor}; font-size: 13px; font-weight: 600;">${evSign}${stock.EV.toFixed(2)}</div>
        </div>
      </div>
    </div>
    
    <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
      <h4 style="color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;">📈 K线图</h4>
      <div id="klineChart_${index}" style="height: 250px; width: 100%;"></div>
    </div>
    
    <div id="klineIndicator_${index}" style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
      <h4 style="color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;">📊 技术指标</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">RSI(14)</div>
          <div id="rsiValue_${index}" style="color: #fbbf24; font-size: 18px; font-weight: 600;">加载中...</div>
        </div>
        <div style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">趋势判断</div>
          <div id="trendValue_${index}" style="color: #818cf8; font-size: 18px; font-weight: 600;">-</div>
        </div>
      </div>
    </div>
    
    <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
      <h4 style="color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;">操作建议</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">买点1</div>
          <div style="color: #22c55e; font-size: 18px; font-weight: 600;">¥${stock.买点1.toFixed(2)}</div>
        </div>
        <div style="background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">买点2</div>
          <div style="color: #60a5fa; font-size: 18px; font-weight: 600;">¥${stock.买点2.toFixed(2)}</div>
        </div>
        <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">止损价</div>
          <div style="color: #ef4444; font-size: 18px; font-weight: 600;">¥${stock.止损.toFixed(2)}</div>
        </div>
        <div style="background: rgba(168,85,247,0.1); border: 1px solid rgba(168,85,247,0.3); border-radius: 8px; padding: 12px;">
          <div style="color: rgba(255,255,255,0.6); font-size: 11px; margin-bottom: 4px;">综合评分</div>
          <div style="color: ${scoreColor}; font-size: 18px; font-weight: 600;">${stock.评分}</div>
        </div>
      </div>
    </div>
    
    <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 16px;">
      <h4 style="color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;">选股条件</h4>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">${conditionTags}</div>
    </div>
    
    <div style="margin-top: 16px; display: flex; gap: 12px;">
      <button id="addToPoolBtn_${index}" style="flex: 1; padding: 10px; border-radius: 8px; border: none; background: rgba(34,197,94,0.5); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
        添加到选股池
      </button>
    </div>
  `;
  
  // 添加事件监听
  const addBtn = document.getElementById(`addToPoolBtn_${index}`);
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addToStockPool(stock.代码, stock.名称, stock.买点1, stock.买点2, stock.止损);
    });
  }
  
  // 加载K线数据
  loadKlineData(stock.代码, index);
}
(window as any).selectAlphaStock = selectAlphaStock;

// 加载K线数据并渲染图表
async function loadKlineData(code: string, index: number) {
  const chartId = `klineChart_${index}`;
  const chartDom = document.getElementById(chartId);
  if (!chartDom || typeof echarts === 'undefined') return;
  
  const chart = echarts.init(chartDom);
  
  try {
    const response = await fetch(`http://127.0.0.1:8765/api/kline/${code}`);
    const result = await response.json();
    
    if (!result.data || result.data.length === 0) {
      chartDom.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">暂无法获取K线数据</div>';
      return;
    }
    
    const dates = result.data.map((item: any) => item.date);
    const klineValues = result.data.map((item: any) => [item.open, item.close, item.low, item.high]);
    const volumes = result.data.map((item: any) => item.volume);
    
    // 计算RSI
    const rsi = calculateRSI(result.data.map((item: any) => item.close), 14);
    
    const option = {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross'
        },
        backgroundColor: 'rgba(0,0,0,0.8)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#fff' }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      grid: [
        {
          left: '10%',
          right: '8%',
          top: '5%',
          height: '50%'
        },
        {
          left: '10%',
          right: '8%',
          top: '62%',
          height: '18%'
        },
        {
          left: '10%',
          right: '8%',
          top: '85%',
          height: '10%'
        }
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
          axisTick: { show: false },
          splitLine: { show: false }
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false }
        },
        {
          type: 'category',
          gridIndex: 2,
          data: dates,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { show: false },
          axisTick: { show: false },
          splitLine: { show: false }
        }
      ],
      yAxis: [
        {
          scale: true,
          splitNumber: 2,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        },
        {
          scale: true,
          gridIndex: 2,
          splitNumber: 2,
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
          axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        }
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1, 2],
          start: 50,
          end: 100
        }
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: klineValues,
          itemStyle: {
            color: '#22c55e',
            color0: '#ef4444',
            borderColor: '#22c55e',
            borderColor0: '#ef4444'
          }
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes.map((vol: number, i: number) => ({
            value: vol,
            itemStyle: {
              color: klineValues[i][1] >= klineValues[i][0] ? '#22c55e' : '#ef4444'
            }
          }))
        },
        {
          name: 'RSI',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: rsi,
          lineStyle: { color: '#fbbf24', width: 2 },
          smooth: true
        }
      ]
    };
    
    chart.setOption(option);
    
    window.addEventListener('resize', () => {
      chart.resize();
    });
    
    // 更新RSI数值显示
    const latestRsi = rsi.length > 0 ? rsi[rsi.length - 1] : 0;
    const rsiElement = document.getElementById(`rsiValue_${index}`);
    if (rsiElement) {
      rsiElement.textContent = latestRsi.toFixed(1);
      if (latestRsi >= 70) {
        rsiElement.style.color = '#ef4444';
      } else if (latestRsi <= 30) {
        rsiElement.style.color = '#22c55e';
      } else {
        rsiElement.style.color = '#fbbf24';
      }
    }
    
    // 更新趋势判断
    const trendElement = document.getElementById(`trendValue_${index}`);
    if (trendElement) {
      if (latestRsi >= 70) {
        trendElement.textContent = '超买';
        trendElement.style.color = '#ef4444';
      } else if (latestRsi <= 30) {
        trendElement.textContent = '超卖';
        trendElement.style.color = '#22c55e';
      } else if (latestRsi > 50) {
        trendElement.textContent = '偏强';
        trendElement.style.color = '#60a5fa';
      } else {
        trendElement.textContent = '偏弱';
        trendElement.style.color = '#a1a1aa';
      }
    }
    
  } catch (error) {
    console.error('[K线] 加载失败:', error);
    chartDom.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0;">K线数据加载失败</div>';
  }
}

// 计算RSI指标
function calculateRSI(prices: number[], period: number): number[] {
  const rsi: number[] = [];
  if (prices.length < period) return rsi;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / (avgLoss || 1);
  rsi.push(Math.round((1 - 1 / (1 + rs)) * 100));
  
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    const newAvgGain = (avgGain * (period - 1) + gain) / period;
    const newAvgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = newAvgGain / (newAvgLoss || 1);
    rsi.push(Math.round((1 - 1 / (1 + rs)) * 100));
  }
  
  return rsi;
}

// 添加到选股池
async function addToStockPool(code: string, name: string, buyPoint1: number, buyPoint2: number, stopLoss: number) {
  try {
    const response = await fetch('http://127.0.0.1:8765/api/add_stock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        name,
        buy_point_1: buyPoint1,
        buy_point_2: buyPoint2,
        stop_loss: stopLoss,
        type: 'candidate'
      })
    });
    
    const result = await response.json();
    if (result.success) {
      alert(name + '(' + code + ') 已添加到选股池！');
    } else {
      alert('添加失败: ' + (result.message || '未知错误'));
    }
  } catch (error) {
    console.error('添加到选股池失败:', error);
    alert('添加失败，请检查网络连接');
  }
}

function initLive2D() {
  setupModelSelector();
  setupSoundSelector();
  setupChatInterface();
  initStockMonitor();
  // 初始化 WebSocket 连接
  initWebSocket();
  // 如果没有下拉框（例如纯网页嵌入），也加载一个默认模型
  if (!document.getElementById('modelSelect') && MODEL_OPTIONS.length > 0) {
    void loadModel(MODEL_OPTIONS[0].path);
  }
}

// 初始化 WebSocket 连接
function initWebSocket() {
  console.log('正在连接到 OpenClaw Gateway...');
  openClawWebSocket.connect().then(success => {
    if (success) {
      console.log('WebSocket 连接成功');
    } else {
      console.warn('WebSocket 连接失败，将继续使用 MCP 接口');
    }
  });

  // 监听 WebSocket 消息
  openClawWebSocket.on('message', (text) => {
    console.log('收到 OpenClaw WebSocket 消息:', text);
    if (text) {
      // 显示机器人回复到聊天记录
      addMessageToChatLog('bot', text);
      // 显示机器人回复到聊天气泡
      if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
        window.writerInstance.type(text);
      } else {
        // 如果writerInstance还未初始化，等待一下再尝试
        setTimeout(() => {
          if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
            window.writerInstance.type(text);
          } else {
            console.warn('writerInstance 未初始化，无法显示消息到聊天气泡');
          }
        }, 100);
      }
      // 播放机器人回复的语音
      textToSpeech(text);
      // 播放随机动作
      playRandomMotion();
    }
  });

  // 监听流式消息（可选，用于实时打字效果）
  openClawWebSocket.on('stream', (text) => {
    console.log('收到流式消息:', text);
    // 这里可以实现实时打字效果，暂时注释掉
    // if (typeof window.writerInstance !== 'undefined' && window.writerInstance) {
    //   window.writerInstance.type(text);
    // }
  });

  // 监听连接状态
  openClawWebSocket.on('connected', () => {
    console.log('WebSocket 连接已建立');
  });
}

initLive2D();