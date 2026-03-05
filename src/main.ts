import * as PIXI from 'pixi.js';

// 将 PIXI 暴露到全局（给 pixi-live2d-display 用）
(window as any).PIXI = PIXI;

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
    // 简化发送逻辑，只发送 POST 请求，不等待返回结果
    // OpenClaw 会通过 MCP 主动推送结果
    const OPENCLAW_API = "http://127.0.0.1:18789";
    const TOKEN = "my-super-secret-token-2025";

    console.log('========== OpenClaw 消息发送详情 ==========');
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

function initLive2D() {
  setupModelSelector();
  setupSoundSelector();
  setupChatInterface();
  // 如果没有下拉框（例如纯网页嵌入），也加载一个默认模型
  if (!document.getElementById('modelSelect') && MODEL_OPTIONS.length > 0) {
    void loadModel(MODEL_OPTIONS[0].path);
  }
}

initLive2D();