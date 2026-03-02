import * as PIXI from 'pixi.js';
import { processChat } from './chatAgentService.js';

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

// 当前 public 下已有的 .model3.json 列表
const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'ele_a0',
    name: 'Ele A0',
    path: `${base}galgame/ele_a0/model.model3.json`,
  },
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
    (window as any).live2dModel = model;

    console.log('Live2D 模型加载成功！');
  } catch (error) {
    console.error('加载模型失败:', error);
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

    // 核心：强行设置模型嘴巴的张合度
    if (currentModel.internalModel && currentModel.internalModel.coreModel && 
        typeof currentModel.internalModel.coreModel.setParameterValueById === 'function') {
      currentModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', volumeValue);
    } else if (typeof (currentModel as any).setParamValue === 'function') {
      // 备选方案：使用 setParamValue
      (currentModel as any).setParamValue('ParamMouthOpenY', volumeValue);
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
      console.log('收到 OpenClaw 消息:', message);
      // 解析消息，提取情感标签和纯文本
      const { emotion, cleanText } = parseEmotionFromText(message);
      // 显示机器人回复
      addMessageToChatLog('bot', cleanText);
      // 触发 Live2D 表情
      if (currentModel && typeof (currentModel as any).motion === 'function') {
        (currentModel as any).motion(emotion);
      }
    });
  }

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
    // 调用 processChat 函数处理用户输入
    const result = await processChat(text);
    
    // 打印表情到控制台
    console.log('解析到的表情:', result.emotion);
    
    // 显示机器人回复
    addMessageToChatLog('bot', result.pureText);
    
    // 触发 Live2D 表情
    if (currentModel && typeof (currentModel as any).motion === 'function') {
      (currentModel as any).motion(result.emotion);
    }
  } catch (error) {
    console.error('发送消息到 LLM 失败:', error);
    // 显示错误消息
    addMessageToChatLog('bot', '哎呀，我好像断网了...');
  }
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
    // 尝试使用浏览器内置的 SpeechSynthesis API
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 设置语音
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = voices.find(voice => voice.name.includes('Chinese') || voice.lang.includes('zh'));
      if (selectedVoice) {
        utterance.voice = selectedVoice;
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