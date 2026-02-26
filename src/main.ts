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
  if (!select || !testBtn) return;

  select.innerHTML = '';

  if (SOUND_OPTIONS.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '暂无音频';
    select.appendChild(opt);
    select.disabled = true;
    testBtn.disabled = true;
    return;
  }

  for (const optDef of SOUND_OPTIONS) {
    const optionEl = document.createElement('option');
    optionEl.value = optDef.id;
    optionEl.textContent = optDef.name;
    select.appendChild(optionEl);
  }

  select.value = SOUND_OPTIONS[0].id;

  testBtn.addEventListener('click', () => {
    if (!currentModel || typeof (currentModel as any).speak !== 'function') {
      console.warn('当前模型不支持 speak 接口');
      return;
    }

    const selectedId = select.value;
    const sound = SOUND_OPTIONS.find((s) => s.id === selectedId);
    if (!sound) return;

    // 停止上一次播放，避免重叠
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    const audio = new Audio(sound.url);
    currentAudio = audio;

    // 先触发一个动作（如果模型有 Action 组会随机播一个）
    if (typeof (currentModel as any).motion === 'function') {
      (currentModel as any).motion('Action');
    }

    // 使用 speak 让模型根据音量自动口型同步
    (currentModel as any).speak(audio);
    void audio.play();
  });
}

function initLive2D() {
  setupModelSelector();
  setupSoundSelector();
  // 如果没有下拉框（例如纯网页嵌入），也加载一个默认模型
  if (!document.getElementById('modelSelect') && MODEL_OPTIONS.length > 0) {
    void loadModel(MODEL_OPTIONS[0].path);
  }
}

initLive2D();