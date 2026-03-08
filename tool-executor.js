/**
 * ST Agent Tools - 工具执行器
 * 编排完整的 Agent 执行循环（AI 调用 → 工具执行 → 结果回传）。
 */

import { buildContext } from './context-builder.js';
import { callAI } from './api-caller.js';
import { McpClient } from './mcp-client.js';

const MODULE_NAME = 'ST-Agent-Tools';

/**
 * 主入口：执行完整的 Agent 管道。
 */
export async function executeAgentPipeline(userPrompt, settings, stApi) {
  const debug = settings.debug;
  if (debug) console.log(`[${MODULE_NAME}] 开始 Agent 管道...`);

  showRunningIndicator(true);

  try {
    // 1. 构建上下文消息
    const messages = buildContext(settings, stApi, userPrompt);
    if (debug) console.log(`[${MODULE_NAME}] 上下文消息数:`, messages.length);

    // 2. 连接 MCP 服务器并收集工具
    const mcpClients = await connectMcpServers(settings);
    const tools = await collectAllTools(mcpClients);
    if (debug) console.log(`[${MODULE_NAME}] 可用工具:`, tools.map(t => t.name));

    // 3. 工具调用循环
    let iteration = 0;
    const maxIter = settings.maxToolCallIterations || 10;
    const toolsUsed = [];

    while (iteration < maxIter) {
      iteration++;
      if (debug) console.log(`[${MODULE_NAME}] 迭代 ${iteration}/${maxIter}`);

      const response = await callAI(messages, tools, settings, stApi);

      // 无工具调用 → 最终响应
      if (!response.toolCalls || response.toolCalls.length === 0) {
        const result = {
          text: response.content || '',
          iterations: iteration,
          toolsUsed,
          usage: response.usage,
        };

        if (debug) console.log(`[${MODULE_NAME}] Agent 完成，共 ${iteration} 次迭代。`);
        return result;
      }

      // 追加 assistant 消息（含工具调用）
      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      // 执行每个工具调用
      for (const tc of response.toolCalls) {
        if (debug) console.log(`[${MODULE_NAME}] 调用工具: ${tc.name}`, tc.arguments);
        toolsUsed.push(tc.name);

        let result;
        try {
          result = await executeTool(tc.name, tc.arguments, mcpClients);
        } catch (err) {
          console.warn(`[${MODULE_NAME}] 工具 "${tc.name}" 执行失败:`, err);
          result = JSON.stringify({ error: err.message });
        }

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        if (debug) console.log(`[${MODULE_NAME}] 工具结果 (${tc.name}):`, resultStr.slice(0, 200));

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        });
      }
    }

    throw new Error(`Agent 超出最大迭代次数 (${maxIter})`);
  } finally {
    showRunningIndicator(false);
  }
}

// ─── MCP 连接 ───

async function connectMcpServers(settings) {
  const clients = [];
  for (const server of settings.mcpServers) {
    if (!server.enabled || !server.url) continue;
    try {
      const client = new McpClient(server);
      await client.connect();
      clients.push(client);
    } catch (err) {
      console.warn(`[${MODULE_NAME}] MCP 服务器 "${server.name}" 连接失败:`, err);
      if (typeof toastr !== 'undefined') {
        toastr.warning(`MCP "${server.name}": ${err.message}`, MODULE_NAME);
      }
    }
  }
  return clients;
}

async function collectAllTools(mcpClients) {
  const tools = [];
  for (const client of mcpClients) {
    try {
      const mcpTools = await client.listTools();
      for (const tool of mcpTools) {
        tools.push({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object', properties: {} },
          _source: 'mcp',
          _client: client,
        });
      }
    } catch (err) {
      console.warn(`[${MODULE_NAME}] 获取工具列表失败 "${client.config.name}":`, err);
    }
  }
  return tools;
}

// ─── 工具路由 ───

async function executeTool(name, args, mcpClients) {
  for (const client of mcpClients) {
    const tool = client.tools.find(t => t.name === name);
    if (tool) {
      const result = await client.callTool(name, args);
      if (result.isError) {
        throw new Error(result.content?.map(c => c.text).join('\n') || '工具执行错误');
      }
      return result.content?.map(c => c.text || JSON.stringify(c)).join('\n') || '';
    }
  }
  throw new Error(`未知工具: ${name}`);
}

// ─── UI 辅助 ───

function showRunningIndicator(show) {
  let indicator = document.getElementById('sat-running');
  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sat-running';
      indicator.className = 'sat-running-indicator';
      indicator.innerHTML = '<div class="sat-spinner"></div><span>Agent 运行中...</span>';
      document.body.appendChild(indicator);
    }
  } else {
    indicator?.remove();
  }
}

