/**
 * ST Agent Tools - API 调用器
 * 双模式：自定义 API Key / 酒馆 API 设置。
 * 两种模式都使用独立 fetch 调用以支持 tools 参数。
 */

const MODULE_NAME = 'ST-Agent-Tools';

export async function callAI(messages, tools, settings, stApi) {
  if (settings.apiMode === 'st-api' && stApi) {
    return callSTApiMode(messages, tools, settings, stApi);
  }
  return callCustomAPI(messages, tools, settings);
}

async function callCustomAPI(messages, tools, settings) {
  const url = settings.customApiUrl?.replace(/\/+$/, '');
  if (!url) throw new Error('未配置 API 端点 URL');
  if (!settings.customApiKey) throw new Error('未配置 API Key');
  if (!settings.customModel) throw new Error('未配置模型名称');

  const body = {
    model: settings.customModel,
    messages,
    max_tokens: settings.customMaxTokens || 4096,
    temperature: settings.customTemperature ?? 0.7,
  };

  if (tools && tools.length > 0) {
    body.tools = formatToolsForOpenAI(tools);
  }

  if (settings.debug) console.log(`[${MODULE_NAME}] API 请求:`, JSON.stringify(body, null, 2));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.stApiTimeoutMs || 120000);

  try {
    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.customApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`API 错误 ${response.status}: ${errText.slice(0, 500)}`);
    }

    const data = await response.json();
    return normalizeResponse(data, settings);
  } finally {
    clearTimeout(timeout);
  }
}

async function callSTApiMode(messages, tools, settings, stApi) {
  const preset = await stApi.preset.get();
  const other = preset?.preset?.other;
  if (!other) throw new Error('无法读取酒馆预设配置');

  const source = other.chat_completion_source;
  let apiUrl = '', apiKey = '', model = '';

  switch (source) {
    case 'custom':
      apiUrl = other.custom_url || '';
      apiKey = other.proxy_password || '';
      model = other.custom_model || '';
      break;
    case 'openai':
      apiUrl = other.reverse_proxy || 'https://api.openai.com/v1';
      apiKey = other.proxy_password || '';
      model = other.openai_model || '';
      break;
    case 'claude':
      apiUrl = other.reverse_proxy || '';
      apiKey = other.proxy_password || '';
      model = other.claude_model || '';
      break;
    case 'makersuite':
      apiUrl = other.reverse_proxy || '';
      apiKey = other.proxy_password || '';
      model = other.google_model || '';
      break;
    case 'openrouter':
      apiUrl = other.reverse_proxy || 'https://openrouter.ai/api/v1';
      apiKey = other.proxy_password || '';
      model = other.openrouter_model || '';
      break;
    case 'deepseek':
      apiUrl = other.reverse_proxy || 'https://api.deepseek.com/v1';
      apiKey = other.proxy_password || '';
      model = other.deepseek_model || '';
      break;
    default:
      apiUrl = other.custom_url || other.reverse_proxy || '';
      apiKey = other.proxy_password || '';
      model = other.custom_model || other.openai_model || '';
  }

  if (!apiUrl) throw new Error(`无法确定 API 地址 (来源: ${source})`);
  if (!apiKey) throw new Error(`酒馆预设中未找到 API Key (来源: ${source})`);
  if (!model) throw new Error(`酒馆预设中未配置模型 (来源: ${source})`);

  return callCustomAPI(messages, tools, {
    ...settings,
    customApiUrl: apiUrl.replace(/\/+$/, ''),
    customApiKey: apiKey,
    customModel: model,
    customMaxTokens: settings.customMaxTokens || other.openai_max_tokens || 4096,
    customTemperature: settings.customTemperature ?? other.temp_openai ?? 0.7,
  });
}

function formatToolsForOpenAI(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || t.parameters || { type: 'object', properties: {} },
    },
  }));
}

function normalizeResponse(data, settings) {
  if (settings?.debug) console.log(`[${MODULE_NAME}] API 响应:`, JSON.stringify(data, null, 2));

  const choice = data.choices?.[0];
  const msg = choice?.message;
  return {
    content: msg?.content || null,
    toolCalls: msg?.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: safeParseJSON(tc.function?.arguments),
    })) || null,
    finishReason: choice?.finish_reason,
    usage: data.usage || null,
  };
}

function safeParseJSON(str) {
  if (typeof str !== 'string') return str || {};
  try { return JSON.parse(str); } catch { return { _raw: str }; }
}
