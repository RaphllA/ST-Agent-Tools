/**
 * ST Agent Tools - 设置管理
 */

const EXTENSION_NAME = 'ST-Agent-Tools';

const DEFAULT_MCP_SERVER = {
  id: 'default-browser',
  name: '浏览器 (默认)',
  url: '',  // TODO: 部署后填入 Cloudflare Workers URL
  transport: 'streamable-http',
  enabled: false,
  apiKey: '',
  headers: {},
};

const DEFAULT_QUICK_ACTIONS = [
  { id: 'xiaohongshu', name: '逛小红书', url: 'https://www.xiaohongshu.com', prompt: '请打开小红书 (https://www.xiaohongshu.com)，浏览推荐页面的内容，总结你看到的有趣帖子和话题。', builtin: true },
  { id: 'tieba', name: '逛贴吧', url: 'https://tieba.baidu.com', prompt: '请打开百度贴吧 (https://tieba.baidu.com)，浏览热门帖子，总结有趣的讨论内容。', builtin: true },
  { id: 'search', name: '搜索', url: '', prompt: '请用浏览器打开搜索引擎，搜索以下内容并总结搜索结果：{query}', builtin: true, needsInput: true },
];

const DEFAULT_SETTINGS = Object.freeze({
  // API 模式
  apiMode: 'custom',              // 'st-api' | 'custom'

  // 自定义 API 配置
  customApiUrl: '',
  customApiKey: '',
  customModel: '',
  customMaxTokens: 4096,
  customTemperature: 0.7,

  // 酒馆 API 模式
  stApiTimeoutMs: 120000,

  // 手动选择的上下文条目
  selectedContext: [],
  // 每项: { type:'character'|'worldbook'|'preset', source:string, entryId:string, label:string, content:string }

  // MCP 服务器
  mcpServers: [{ ...DEFAULT_MCP_SERVER }],

  // 快捷操作
  quickActions: [...DEFAULT_QUICK_ACTIONS],

  // Agent 系统提示
  customSystemPrompt: '',

  // 高级
  maxToolCallIterations: 10,
  showInChat: true,
  debug: false,
});

let _ctx = null;

function deepMergeDefaults(target, defaults) {
  for (const [key, val] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = typeof val === 'object' && val !== null && !Array.isArray(val)
        ? JSON.parse(JSON.stringify(val))
        : Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : val;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMergeDefaults(target[key], val);
    }
  }
}

export function initSettings(ctx) {
  _ctx = ctx;
  const root = ctx?.extensionSettings;
  if (!root) return getSettings();
  root[EXTENSION_NAME] = root[EXTENSION_NAME] || {};
  deepMergeDefaults(root[EXTENSION_NAME], DEFAULT_SETTINGS);
  return root[EXTENSION_NAME];
}

export function getSettings() {
  const root = _ctx?.extensionSettings;
  if (!root || !root[EXTENSION_NAME]) {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
  return root[EXTENSION_NAME];
}

export function updateSettings(partial) {
  const settings = getSettings();
  Object.assign(settings, partial);
  saveSettings();
  return settings;
}

export function saveSettings() {
  _ctx?.saveSettingsDebounced?.();
}

export function getExtensionName() {
  return EXTENSION_NAME;
}

export { DEFAULT_SETTINGS, DEFAULT_MCP_SERVER, DEFAULT_QUICK_ACTIONS };
