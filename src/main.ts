import * as PIXI from 'pixi.js';

// 将 PIXI 暴露到全局
(window as any).PIXI = PIXI;

async function initLive2D() {
  const { Live2DModel } = await import('pixi-live2d-display/cubism4');

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  const app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: window,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
  });

  // 全局关闭舞台的事件模式
  (app.stage as any).eventMode = 'none';

  const modelUrl = '/galgame/ele_a0/model.model3.json';

  try {
    console.log('正在加载模型...');

    // 【关键修改 1】: 传入 autoInteract: false，彻底关闭内置的交互监听，防止 v7 版本报错
    const model = await Live2DModel.from(modelUrl, { autoInteract: false });
    
    // 【关键修改 2】: 显式关闭模型本身的事件响应
    model.interactive = false;
    (model as any).eventMode = 'none';

    // 调整缩放 (根据需要自行调整)
    const scale = 0.2; 
    model.scale.set(scale);
    model.x = app.screen.width / 2 - model.width / 2;
    model.y = app.screen.height / 2 - model.height / 2 + 150; // 稍微往下挪一点

    app.stage.addChild(model as any);
    (window as any).live2dModel = model;

    // -------------------------------------------------------------------
    // 【关键修改 3】: 使用你的 DOM 事件系统来驱动视线和动作
    // -------------------------------------------------------------------

    // 1. 鼠标移动 -> 视线跟随
    window.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // focus 方法底层会自动把屏幕坐标转换为模型的局部坐标系
      model.focus(x, y);
    });

    // 2. 鼠标点击 -> 触发动作
    window.addEventListener('pointerdown', () => {
        // 注意：因为你的 JSON 里没有 HitAreas，model.tap() 可能不知道该播什么动作。
        // 我们直接读取你的 model3.json，里面定义了 "Action" 这个动作组。
        // 所以我们手动让它随机播放一个 "Action" 组里的动作！
        
        // 播放动作组 "Action" 里面的随机一个动作
        model.motion("Action"); 
        
        // 顺便可以打印一下测试
        console.log('触发动作: Action');
    });

    console.log('Live2D 模型加载成功！不再报错啦！');
  } catch (error) {
    console.error('加载模型失败:', error);
  }
}

initLive2D();