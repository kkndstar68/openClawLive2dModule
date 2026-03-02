/**
 * chatAgentService.js
 * API 交互与文本处理模块
 */

const OPENCLAW_API = "http://127.0.0.1:18789";
const TOKEN = "my-super-secret-token-2025";

/**
 * 发送消息给 Agent 并等待结果
 */
async function sendMessageToAgent(userInput) {
  try {
    console.log('正在发送消息到 Agent:', userInput);
    
    // 第一步：发送消息，获取 runId
     //const response = await fetch(`${OPENCLAW_API}/v1/chat/completions`, {
    const response = await fetch(`${OPENCLAW_API}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
          // 如果你有多个 Agent，可以通过这个 Header 指定特定的 Agent ID，比如 'main'
        'x-openclaw-agent-id': 'main' 
      },
      body: JSON.stringify(
        {
            stream: false,     // false 表示不使用流式输出，等待完整结果一次性返回
        message: userInput,
        name: "生活助手",
        sessionKey: "live2d-pet"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const data = await response.json();
    console.log('响应数据:', data);
    
    // 第二步：如果有 runId，轮询获取结果
    if (data.runId) {
      return await pollForResult(data.runId);
    }
    
    return data;
  } catch (error) {
    console.error('发送消息到 Agent 失败:', error);
    throw error;
  }
}

/**
 * 轮询获取运行结果
 */
async function pollForResult(runId) {
  const maxAttempts = 120;  // 最多等120次
  const interval = 500;     // 每0.5秒查一次
  
  console.log(`开始轮询 runId: ${runId}`);
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, interval));
    
    try {
      const res = await fetch(`${OPENCLAW_API}/runs/${runId}`, {
        headers: { 
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!res.ok) {
        console.log(`轮询第${i+1}次: HTTP ${res.status}`);
        continue;
      }
      
      const status = await res.json();
      console.log(`轮询第${i+1}次:`, status);
      
      // 检查是否完成
      if (status.status === 'completed' || status.result || status.output || status.response) {
        console.log('任务完成:', status);
        return status;
      }
      
      // 如果有错误
      if (status.status === 'failed' || status.error) {
        throw new Error(`任务失败: ${status.error || '未知错误'}`);
      }
    } catch (e) {
      console.log(`轮询第${i+1}次出错:`, e.message);
    }
  }
  
  throw new Error('获取结果超时');
}

/**
 * 清洗 Markdown 格式的附件内容
 */
function cleanMarkdownAttachments(rawText) {
  if (!rawText) return '';
  let cleanText = rawText.replace(/!\[.*?\]\(.*?\)/g, '');
  cleanText = cleanText.replace(/\[.*?\]\(.*?\)/g, '');
  cleanText = cleanText.trim().replace(/\s+/g, ' ');
  return cleanText;
}

/**
 * 解析情感标签和纯文本
 */
function parseEmotionAndText(cleanText) {
  if (!cleanText) {
    return { emotion: 'neutral', pureText: '' };
  }

  const emotionRegex = /^\[(\w+)\]\s*(.*)$/;
  const match = cleanText.match(emotionRegex);

  if (match) {
    return {
      emotion: match[1],
      pureText: match[2].trim()
    };
  }

  return {
    emotion: 'neutral',
    pureText: cleanText
  };
}

/**
 * 从 OpenClaw 响应中提取文本
 */
// function extractTextFromResponse(response) {
//   console.log('完整响应对象:', JSON.stringify(response, null, 2));
  
//   // 尝试各种可能的字段
//   if (response.result) {
//     if (typeof response.result === 'string') return response.result;
//     if (response.result.text) return response.result.text;
//     if (response.result.content) return response.result.content;
//     if (response.result.message) return response.result.message;
//     if (response.result.response) return response.result.response;
//   }
  
//   if (response.output) {
//     if (typeof response.output === 'string') return response.output;
//     if (response.output.text) return response.output.text;
//     if (response.output.content) return response.output.content;
//   }
  
//   if (response.response) {
//     if (typeof response.response === 'string') return response.response;
//     if (response.response.text) return response.response.text;
//   }
  
//   if (response.text) return response.text;
//   if (response.content) return response.content;
//   if (response.message) return response.message;
  
//   // 如果有 messages 数组
//   if (response.messages && Array.isArray(response.messages)) {
//     const lastMsg = response.messages[response.messages.length - 1];
//     if (lastMsg && lastMsg.content) return lastMsg.content;
//   }
  
//   // 如果有 choices 数组 (OpenAI 格式)
//   if (response.choices && Array.isArray(response.choices)) {
//     const choice = response.choices[0];
//     if (choice.message && choice.message.content) return choice.message.content;
//     if (choice.text) return choice.text;
//   }
  
//   return null;
// }

/*    gemini的方法 */
function extractTextFromResponse(response) {
  // 因为现在用的是标准的 OpenAI 格式，提取路径非常固定明确
  if (response && response.choices && response.choices.length > 0) {
    console.log(' 回調的內容',response.choices[0].message);
    const message = response.choices[0].message;
    if (message && message.content) {
      return message.content;
    }
  }
  return null;
}

/**
 * 处理聊天流程
 */
async function processChat(userInput) {
  try {
    const response = await sendMessageToAgent(userInput);
    
    // 提取文本内容
    let rawText = extractTextFromResponse(response);
    
    if (!rawText) {
      console.error('无法提取文本，完整响应:', response);
      throw new Error('无法从响应中提取文本');
    }
    
    console.log('提取到的文本:', rawText);
    
    const cleanText = cleanMarkdownAttachments(rawText);
    console.log('清洗后的文本:', cleanText);
    
    const result = parseEmotionAndText(cleanText);
    console.log('解析结果:', result);
    
    return result;
  } catch (error) {
    console.error('处理聊天失败:', error);
    return {
      emotion: 'sad',
      pureText: '哎呀，我好像断网了...'
    };
  }
}

export {
  sendMessageToAgent,
  cleanMarkdownAttachments,
  parseEmotionAndText,
  processChat
};
