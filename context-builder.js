/**
 * ST Agent Tools - 上下文构建器
 * 从手动选择的上下文条目构建 messages 数组。
 */

export function buildContext(settings, stApi, userPrompt) {
  const systemParts = [];

  // 自定义 Agent 系统提示
  if (settings.customSystemPrompt) {
    systemParts.push(settings.customSystemPrompt);
  }

  // 手动选择的上下文条目
  for (const item of (settings.selectedContext || [])) {
    if (item.content) {
      systemParts.push(`[${item.label}]\n${item.content}`);
    }
  }

  const messages = [];
  if (systemParts.length > 0) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') });
  }
  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  }

  return messages;
}
