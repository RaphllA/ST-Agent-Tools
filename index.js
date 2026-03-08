/**
 * ST Agent Tools - 入口
 *
 * SillyTavern 扩展：让角色卡拥有使用 MCP 工具（浏览器、搜索等）的能力。
 * 通过独立的 AI 调用管道实现，不干预酒馆正常聊天流程。
 */

import { initSettings, getSettings, saveSettings } from './settings.js';
import { registerUI, showAgentPromptDialog } from './ui.js';
import { executeAgentPipeline } from './tool-executor.js';

const MODULE_NAME = 'ST-Agent-Tools';

if (globalThis.__stAgentToolsLoaded) {
  console.warn(`[${MODULE_NAME}] 已加载，跳过重复初始化。`);
} else {
  globalThis.__stAgentToolsLoaded = true;
  init();
}

async function waitForSTAPI(maxMs = 15000) {
  if (window.ST_API) return window.ST_API;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 200));
    if (window.ST_API) return window.ST_API;
  }
  return null;
}

async function init() {
  try {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) {
      console.error(`[${MODULE_NAME}] SillyTavern 上下文不可用`);
      return;
    }

    const stApi = await waitForSTAPI();
    if (!stApi) {
      console.warn(`[${MODULE_NAME}] st-api-wrapper 未找到，部分功能将受限。`);
    }

    initSettings(ctx);

    if (stApi) {
      await registerUI(stApi, ctx);
      await registerSlashCommand(stApi);
    } else {
      const { eventSource, event_types } = ctx;
      eventSource?.on(event_types.APP_READY, () => registerFallbackUI());
    }

    globalThis.__stAgentTools = { runAgent, getSettings };
    console.log(`[${MODULE_NAME}] 初始化成功。`);
  } catch (err) {
    console.error(`[${MODULE_NAME}] 初始化失败:`, err);
  }
}

export async function runAgent(userPrompt) {
  const stApi = window.ST_API || null;
  const settings = getSettings();

  if (!userPrompt) {
    userPrompt = await showAgentPromptDialog();
    if (!userPrompt) return null;
  }

  try {
    const result = await executeAgentPipeline(userPrompt, settings, stApi);
    return result;
  } catch (err) {
    console.error(`[${MODULE_NAME}] Agent 错误:`, err);
    if (typeof toastr !== 'undefined') {
      toastr.error(`Agent 错误: ${err.message}`, MODULE_NAME);
    }
    return null;
  }
}

async function registerSlashCommand(stApi) {
  try {
    await stApi.slashCommand.register({
      name: 'agent',
      aliases: ['ag'],
      callback: async (slashCtx) => {
        const prompt = slashCtx.unnamedArgs || '';
        const result = await runAgent(prompt || undefined);
        return result?.text || '';
      },
      helpString: '运行 Agent Tools。用法: /agent <你的指令>',
      unnamedArgumentList: [
        { description: '发送给 Agent 的指令', typeList: ['string'], isRequired: false },
      ],
    });
  } catch (err) {
    console.warn(`[${MODULE_NAME}] 注册 /agent 命令失败:`, err);
  }
}

function registerFallbackUI() {
  const target = document.getElementById('extensions_settings2');
  if (!target) return;
  const panel = document.createElement('div');
  panel.className = 'sat-settings-section expanded';
  panel.innerHTML = `
    <h4>ST Agent Tools</h4>
    <div class="sat-section-body">
      <p style="color: var(--SmartThemeQuoteColor, #888); font-size: 0.85em;">
        需要安装 st-api-wrapper 扩展才能使用完整功能。
      </p>
    </div>
  `;
  target.prepend(panel);
}
