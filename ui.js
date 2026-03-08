/**
 * ST Agent Tools - UI 模块
 * 顶部工具栏抽屉（主操作面板）+ 扩展设置面板（配置）
 */

import { getSettings, saveSettings, DEFAULT_MCP_SERVER } from './settings.js';

let _stApi = null;
let _ctx = null;
let _runAgentFn = null;

export async function registerUI(stApi, ctx) {
  _stApi = stApi;
  _ctx = ctx;
  const { runAgent } = await import('./index.js');
  _runAgentFn = runAgent;

  // 顶部工具栏操作面板
  await stApi.ui.registerTopSettingsDrawer({
    id: 'st-agent-tools.top',
    icon: 'fa-solid fa-robot fa-fw',
    title: 'Agent Tools',
    content: { kind: 'render', render: (container) => renderTopPanel(container) },
  });

  // 扩展设置面板（配置用）
  await stApi.ui.registerSettingsPanel({
    id: 'st-agent-tools.settings',
    title: 'ST Agent Tools 设置',
    target: 'extensions_settings2',
    expanded: false,
    content: { kind: 'render', render: (container) => renderSettingsPanel(container) },
  });
}

// ═══════════════════════════════════════
// 顶部操作面板
// ═══════════════════════════════════════

function renderTopPanel(container) {
  const settings = getSettings();
  container.innerHTML = '';

  // ── 快捷操作 ──
  const qaSection = el('div', 'sat-top-section');
  qaSection.appendChild(el('div', 'sat-top-label', '快捷操作'));
  const qaGrid = el('div', 'sat-qa-grid');

  for (const action of settings.quickActions) {
    const btn = el('button', 'menu_button sat-qa-btn');
    btn.textContent = action.name;
    btn.title = action.prompt;
    btn.onclick = () => handleQuickAction(action);
    qaGrid.appendChild(btn);
  }
  qaSection.appendChild(qaGrid);
  container.appendChild(qaSection);

  // ── 上下文管理 ──
  const ctxSection = el('div', 'sat-top-section');
  ctxSection.appendChild(el('div', 'sat-top-label', '上下文'));

  const ctxList = el('div', 'sat-ctx-list');
  ctxList.id = 'sat-ctx-list';
  renderContextList(ctxList, settings);
  ctxSection.appendChild(ctxList);

  const ctxActions = el('div', 'sat-ctx-actions');
  const addBtn = el('button', 'menu_button', '+ 添加');
  addBtn.onclick = () => showContextSourceDialog(settings, ctxList);
  const clearBtn = el('button', 'menu_button', '清空');
  clearBtn.onclick = () => { settings.selectedContext = []; saveSettings(); renderContextList(ctxList, settings); };
  ctxActions.appendChild(addBtn);
  ctxActions.appendChild(clearBtn);
  ctxSection.appendChild(ctxActions);
  container.appendChild(ctxSection);

  // ── 自由对话 ──
  const chatSection = el('div', 'sat-top-section');
  chatSection.appendChild(el('div', 'sat-top-label', '自由对话'));
  const chatRow = el('div', 'sat-chat-row');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text_pole sat-chat-input';
  input.placeholder = '输入指令发送给 Agent...';
  input.id = 'sat-chat-input';
  const runBtn = el('button', 'menu_button sat-run-btn', '▶ 运行');
  runBtn.onclick = () => {
    const prompt = input.value.trim();
    if (prompt) { input.value = ''; _runAgentFn?.(prompt); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { runBtn.click(); }
  });
  chatRow.appendChild(input);
  chatRow.appendChild(runBtn);
  chatSection.appendChild(chatRow);
  container.appendChild(chatSection);
}

// ─── 快捷操作处理 ───

async function handleQuickAction(action) {
  let prompt = action.prompt;
  if (action.needsInput) {
    const query = await showInputDialog('搜索', '请输入搜索内容：');
    if (!query) return;
    prompt = prompt.replace('{query}', query);
  }
  _runAgentFn?.(prompt);
}

// ─── 上下文列表 ───

function renderContextList(listEl, settings) {
  listEl.innerHTML = '';
  if (!settings.selectedContext?.length) {
    listEl.appendChild(el('div', 'sat-ctx-empty', '暂无上下文，点击"添加"选择内容'));
    return;
  }
  for (let i = 0; i < settings.selectedContext.length; i++) {
    const item = settings.selectedContext[i];
    const row = el('div', 'sat-ctx-item');
    const tag = el('span', `sat-ctx-tag sat-ctx-tag-${item.type}`, typeLabel(item.type));
    const label = el('span', 'sat-ctx-item-label', item.label);
    label.title = item.content?.slice(0, 200) || '';
    const delBtn = el('button', 'sat-ctx-del', '×');
    delBtn.onclick = () => {
      settings.selectedContext.splice(i, 1);
      saveSettings();
      renderContextList(listEl, settings);
    };
    row.appendChild(tag);
    row.appendChild(label);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  }
}

function typeLabel(type) {
  return { character: '角色', worldbook: '世界书', preset: '预设' }[type] || type;
}

// ═══════════════════════════════════════
// 上下文选择弹窗
// ═══════════════════════════════════════

function showContextSourceDialog(settings, listEl) {
  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog');
  dialog.innerHTML = `<h3>选择上下文来源</h3>`;

  const options = [
    { type: 'character', icon: 'fa-user', label: '角色卡信息' },
    { type: 'worldbook', icon: 'fa-book', label: '世界书' },
    { type: 'preset', icon: 'fa-sliders', label: '预设条目' },
  ];

  for (const opt of options) {
    const btn = el('button', 'menu_button sat-source-btn');
    btn.innerHTML = `<i class="fa-solid ${opt.icon}"></i> ${opt.label}`;
    btn.onclick = async () => {
      overlay.remove();
      if (opt.type === 'character') await showCharacterPicker(settings, listEl);
      else if (opt.type === 'worldbook') await showWorldBookPicker(settings, listEl);
      else if (opt.type === 'preset') await showPresetPicker(settings, listEl);
    };
    dialog.appendChild(btn);
  }

  addCancelButton(dialog, overlay);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ─── 角色卡选择 ───

async function showCharacterPicker(settings, listEl) {
  const ctx = SillyTavern?.getContext?.();
  if (!ctx?.name2 || !_stApi) {
    toastr?.warning?.('请先选择一个角色', 'Agent Tools');
    return;
  }

  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog sat-dialog-wide');
  dialog.innerHTML = `<h3>角色卡: ${escHtml(ctx.name2)}</h3><div class="sat-loading">读取中...</div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  try {
    const data = await _stApi.character.get({ name: ctx.name2 });
    const char = data?.character;
    if (!char) throw new Error('读取角色数据失败');

    const fields = [];
    if (char.description) fields.push({ id: 'desc', label: '角色描述', content: char.description });
    if (char.other?.personality) fields.push({ id: 'personality', label: '性格', content: char.other.personality });
    if (char.other?.scenario) fields.push({ id: 'scenario', label: '场景', content: char.other.scenario });
    if (char.other?.data?.system_prompt) fields.push({ id: 'sysprompt', label: '系统提示', content: char.other.data.system_prompt });
    if (char.message?.length) fields.push({ id: 'greeting', label: '问候消息', content: char.message.join('\n---\n') });

    dialog.innerHTML = `<h3>角色卡: ${escHtml(ctx.name2)}</h3>`;
    const checkboxes = renderCheckboxList(dialog, fields);
    addConfirmButtons(dialog, overlay, () => {
      for (const [field, cb] of checkboxes) {
        if (cb.checked) {
          settings.selectedContext.push({
            type: 'character', source: ctx.name2, entryId: field.id,
            label: `${ctx.name2} - ${field.label}`, content: field.content,
          });
        }
      }
      saveSettings();
      renderContextList(listEl, settings);
    });
  } catch (err) {
    dialog.innerHTML = `<h3>错误</h3><p>${escHtml(err.message)}</p>`;
    addCancelButton(dialog, overlay);
  }
}

// ─── 世界书选择 ───

async function showWorldBookPicker(settings, listEl) {
  if (!_stApi) return;

  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog sat-dialog-wide');
  dialog.innerHTML = `<h3>选择世界书</h3><div class="sat-loading">读取中...</div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  try {
    const result = await _stApi.worldBook.list();
    const books = result?.worldBooks || [];

    dialog.innerHTML = `<h3>选择世界书</h3>`;
    if (books.length === 0) {
      dialog.appendChild(el('p', '', '没有可用的世界书'));
      addCancelButton(dialog, overlay);
      return;
    }

    for (const book of books) {
      const btn = el('button', 'menu_button sat-source-btn');
      btn.textContent = `${book.name} (${book.scope})`;
      btn.onclick = async () => {
        overlay.remove();
        await showWorldBookEntryPicker(book.name, book.scope, settings, listEl);
      };
      dialog.appendChild(btn);
    }
    addCancelButton(dialog, overlay);
  } catch (err) {
    dialog.innerHTML = `<h3>错误</h3><p>${escHtml(err.message)}</p>`;
    addCancelButton(dialog, overlay);
  }
}

async function showWorldBookEntryPicker(bookName, scope, settings, listEl) {
  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog sat-dialog-wide');
  dialog.innerHTML = `<h3>世界书: ${escHtml(bookName)}</h3><div class="sat-loading">读取中...</div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  try {
    const result = await _stApi.worldBook.get({ name: bookName, scope });
    const entries = result?.worldBook?.entries || [];

    dialog.innerHTML = `<h3>世界书: ${escHtml(bookName)} (${entries.length} 条目)</h3>`;

    if (entries.length === 0) {
      dialog.appendChild(el('p', '', '此世界书没有条目'));
      addCancelButton(dialog, overlay);
      return;
    }

    const fields = entries.map(e => ({
      id: String(e.index),
      label: e.name || `条目 #${e.index}`,
      content: e.content || '',
      preview: (e.content || '').slice(0, 60) + ((e.content?.length || 0) > 60 ? '...' : ''),
      enabled: e.enabled,
    }));

    const scrollBox = el('div', 'sat-scroll-box');
    const checkboxes = renderCheckboxList(scrollBox, fields, true);
    dialog.appendChild(scrollBox);

    addConfirmButtons(dialog, overlay, () => {
      for (const [field, cb] of checkboxes) {
        if (cb.checked) {
          settings.selectedContext.push({
            type: 'worldbook', source: bookName, entryId: field.id,
            label: `${bookName} - ${field.label}`, content: field.content,
          });
        }
      }
      saveSettings();
      renderContextList(listEl, settings);
    });
  } catch (err) {
    dialog.innerHTML = `<h3>错误</h3><p>${escHtml(err.message)}</p>`;
    addCancelButton(dialog, overlay);
  }
}

// ─── 预设选择 ───

async function showPresetPicker(settings, listEl) {
  if (!_stApi) return;

  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog sat-dialog-wide');
  dialog.innerHTML = `<h3>预设条目</h3><div class="sat-loading">读取中...</div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  try {
    const result = await _stApi.preset.get();
    const prompts = result?.preset?.prompts || [];

    dialog.innerHTML = `<h3>预设: ${escHtml(result?.preset?.name || '当前')}</h3>`;

    if (prompts.length === 0) {
      dialog.appendChild(el('p', '', '预设中没有 Prompt 条目'));
      addCancelButton(dialog, overlay);
      return;
    }

    const fields = prompts.filter(p => p.content).map(p => ({
      id: p.identifier,
      label: p.name || p.identifier,
      content: p.content,
      preview: p.content.slice(0, 60) + (p.content.length > 60 ? '...' : ''),
      enabled: p.enabled,
    }));

    const scrollBox = el('div', 'sat-scroll-box');
    const checkboxes = renderCheckboxList(scrollBox, fields, true);
    dialog.appendChild(scrollBox);

    addConfirmButtons(dialog, overlay, () => {
      for (const [field, cb] of checkboxes) {
        if (cb.checked) {
          settings.selectedContext.push({
            type: 'preset', source: result?.preset?.name || 'current', entryId: field.id,
            label: `预设 - ${field.label}`, content: field.content,
          });
        }
      }
      saveSettings();
      renderContextList(listEl, settings);
    });
  } catch (err) {
    dialog.innerHTML = `<h3>错误</h3><p>${escHtml(err.message)}</p>`;
    addCancelButton(dialog, overlay);
  }
}

// ═══════════════════════════════════════
// 扩展设置面板（配置用）
// ═══════════════════════════════════════

function renderSettingsPanel(container) {
  const settings = getSettings();
  container.innerHTML = '';

  // API 配置
  container.appendChild(createSection('API 配置', true, (body) => {
    body.appendChild(createSelectRow('API 模式', 'apiMode', settings.apiMode, [
      { value: 'custom', label: '自定义 API Key' },
      { value: 'st-api', label: '使用酒馆 API' },
    ]));
    const customFields = el('div'); customFields.id = 'sat-custom-api-fields';
    customFields.style.display = settings.apiMode === 'custom' ? 'block' : 'none';
    customFields.appendChild(createTextRow('API 端点', 'customApiUrl', settings.customApiUrl, 'https://api.openai.com/v1'));
    customFields.appendChild(createPasswordRow('API Key', 'customApiKey', settings.customApiKey));
    customFields.appendChild(createTextRow('模型', 'customModel', settings.customModel, 'gpt-4o'));
    customFields.appendChild(createNumberRow('最大 Token', 'customMaxTokens', settings.customMaxTokens, 1, 128000));
    customFields.appendChild(createRangeRow('温度', 'customTemperature', settings.customTemperature, 0, 2, 0.01));
    body.appendChild(customFields);
    const stFields = el('div'); stFields.id = 'sat-st-api-fields';
    stFields.style.display = settings.apiMode === 'st-api' ? 'block' : 'none';
    stFields.appendChild(createNumberRow('超时 (ms)', 'stApiTimeoutMs', settings.stApiTimeoutMs, 5000, 600000));
    body.appendChild(stFields);
  }));

  // MCP 服务器
  container.appendChild(createSection('MCP 服务器', false, (body) => {
    const listEl = el('div', 'sat-mcp-server-list'); listEl.id = 'sat-mcp-list';
    renderMcpList(listEl, settings);
    body.appendChild(listEl);
    const addBtn = el('button', 'menu_button', '+ 添加 MCP 服务器');
    addBtn.onclick = () => showMcpServerDialog(null, settings, listEl);
    body.appendChild(addBtn);
  }));

  // 快捷操作管理
  container.appendChild(createSection('快捷操作管理', false, (body) => {
    const listEl = el('div', 'sat-qa-manage-list'); listEl.id = 'sat-qa-manage-list';
    renderQuickActionManageList(listEl, settings);
    body.appendChild(listEl);
    const addBtn = el('button', 'menu_button', '+ 添加快捷操作');
    addBtn.onclick = () => showQuickActionDialog(null, settings, listEl);
    body.appendChild(addBtn);
  }));

  // Agent 系统提示
  container.appendChild(createSection('Agent 系统提示', false, (body) => {
    const area = document.createElement('textarea');
    area.className = 'text_pole';
    area.style.minHeight = '80px';
    area.value = settings.customSystemPrompt || '';
    area.placeholder = '为 Agent 添加额外指令 (例如: "你是一个可爱的助手...")';
    area.addEventListener('change', () => { settings.customSystemPrompt = area.value; saveSettings(); });
    body.appendChild(area);
  }));

  // 高级
  container.appendChild(createSection('高级设置', false, (body) => {
    body.appendChild(createNumberRow('最大工具迭代', 'maxToolCallIterations', settings.maxToolCallIterations, 1, 50));
    body.appendChild(createCheckboxRow('结果显示到聊天', 'showInChat', settings.showInChat));
    body.appendChild(createCheckboxRow('调试日志', 'debug', settings.debug));
  }));

  wireSettingsListeners(container, settings);
}

// ─── 快捷操作管理列表 ───

function renderQuickActionManageList(listEl, settings) {
  listEl.innerHTML = '';
  for (const action of settings.quickActions) {
    const row = el('div', 'sat-mcp-server-item');
    row.innerHTML = `
      <div class="sat-mcp-server-info">
        <div class="sat-mcp-server-name">${escHtml(action.name)}</div>
        <div class="sat-mcp-server-url">${escHtml(action.prompt?.slice(0, 50) || '')}</div>
      </div>
      <div class="sat-mcp-server-actions">
        <button class="sat-btn sat-btn-sm sat-qa-edit" title="编辑"><i class="fa-solid fa-pen"></i></button>
        <button class="sat-btn sat-btn-sm sat-btn-danger sat-qa-delete" title="删除"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    row.querySelector('.sat-qa-edit').onclick = () => showQuickActionDialog(action, settings, listEl);
    row.querySelector('.sat-qa-delete').onclick = () => {
      const idx = settings.quickActions.indexOf(action);
      if (idx >= 0) { settings.quickActions.splice(idx, 1); saveSettings(); renderQuickActionManageList(listEl, settings); }
    };
    listEl.appendChild(row);
  }
}

function showQuickActionDialog(existing, settings, listEl) {
  const isEdit = !!existing;
  const action = isEdit ? { ...existing } : { id: crypto.randomUUID(), name: '', url: '', prompt: '', builtin: false, needsInput: false };

  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog');
  dialog.innerHTML = `
    <h3>${isEdit ? '编辑' : '添加'}快捷操作</h3>
    <div class="sat-row"><label>名称</label><input type="text" id="sat-qa-name" class="text_pole" value="${escHtml(action.name)}"></div>
    <div class="sat-row"><label>网站 URL</label><input type="text" id="sat-qa-url" class="text_pole" value="${escHtml(action.url || '')}" placeholder="可选"></div>
    <div class="sat-row" style="flex-direction:column;align-items:stretch"><label>提示词模板</label><textarea id="sat-qa-prompt" class="text_pole" style="min-height:60px">${escHtml(action.prompt)}</textarea></div>
    <div class="sat-checkbox-row"><input type="checkbox" id="sat-qa-needs-input" ${action.needsInput ? 'checked' : ''}><label for="sat-qa-needs-input">需要用户输入 (用 {query} 占位)</label></div>
  `;
  const actions = el('div', 'sat-dialog-actions');
  const cancelBtn = el('button', 'menu_button', '取消'); cancelBtn.onclick = () => overlay.remove();
  const saveBtn = el('button', 'menu_button', '保存');
  saveBtn.onclick = () => {
    action.name = dialog.querySelector('#sat-qa-name').value.trim() || '未命名';
    action.url = dialog.querySelector('#sat-qa-url').value.trim();
    action.prompt = dialog.querySelector('#sat-qa-prompt').value;
    action.needsInput = dialog.querySelector('#sat-qa-needs-input').checked;
    if (isEdit) Object.assign(existing, action);
    else settings.quickActions.push(action);
    saveSettings();
    renderQuickActionManageList(listEl, settings);
    overlay.remove();
  };
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ─── MCP 服务器管理 ───

function renderMcpList(listEl, settings) {
  listEl.innerHTML = '';
  for (const server of settings.mcpServers) {
    const item = el('div', 'sat-mcp-server-item');
    item.innerHTML = `
      <div class="sat-mcp-status" title="未连接"></div>
      <div class="sat-mcp-server-info">
        <div class="sat-mcp-server-name">${escHtml(server.name)}</div>
        <div class="sat-mcp-server-url">${escHtml(server.url || '(未设置 URL)')}</div>
      </div>
      <div class="sat-mcp-server-actions">
        <button class="sat-btn sat-btn-sm sat-mcp-toggle" title="${server.enabled ? '禁用' : '启用'}">
          <i class="fa-solid ${server.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
        </button>
        <button class="sat-btn sat-btn-sm sat-mcp-edit" title="编辑"><i class="fa-solid fa-pen"></i></button>
        <button class="sat-btn sat-btn-sm sat-btn-danger sat-mcp-delete" title="删除"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    item.querySelector('.sat-mcp-toggle').onclick = () => { server.enabled = !server.enabled; saveSettings(); renderMcpList(listEl, settings); };
    item.querySelector('.sat-mcp-edit').onclick = () => showMcpServerDialog(server, settings, listEl);
    item.querySelector('.sat-mcp-delete').onclick = () => {
      const idx = settings.mcpServers.indexOf(server);
      if (idx >= 0) { settings.mcpServers.splice(idx, 1); saveSettings(); renderMcpList(listEl, settings); }
    };
    listEl.appendChild(item);
  }
}

function showMcpServerDialog(existing, settings, listEl) {
  const isEdit = !!existing;
  const server = isEdit ? { ...existing } : { id: crypto.randomUUID(), name: '', url: '', transport: 'streamable-http', enabled: true, apiKey: '', headers: {} };

  const overlay = createOverlay();
  const dialog = el('div', 'sat-dialog');
  dialog.innerHTML = `
    <h3>${isEdit ? '编辑' : '添加'} MCP 服务器</h3>
    <div class="sat-row"><label>名称</label><input type="text" id="sat-mcp-name" class="text_pole" value="${escHtml(server.name)}"></div>
    <div class="sat-row"><label>URL</label><input type="text" id="sat-mcp-url" class="text_pole" value="${escHtml(server.url)}" placeholder="https://..."></div>
    <div class="sat-row"><label>协议</label>
      <select id="sat-mcp-transport" class="text_pole">
        <option value="streamable-http" ${server.transport === 'streamable-http' ? 'selected' : ''}>Streamable HTTP</option>
        <option value="sse" ${server.transport === 'sse' ? 'selected' : ''}>SSE</option>
      </select>
    </div>
    <div class="sat-row"><label>API Key</label><input type="password" id="sat-mcp-apikey" class="text_pole" value="${escHtml(server.apiKey || '')}" placeholder="可选"></div>
  `;
  const actions = el('div', 'sat-dialog-actions');
  const cancelBtn = el('button', 'menu_button', '取消'); cancelBtn.onclick = () => overlay.remove();
  const saveBtn = el('button', 'menu_button', '保存');
  saveBtn.onclick = () => {
    server.name = dialog.querySelector('#sat-mcp-name').value.trim() || '未命名';
    server.url = dialog.querySelector('#sat-mcp-url').value.trim();
    server.transport = dialog.querySelector('#sat-mcp-transport').value;
    server.apiKey = dialog.querySelector('#sat-mcp-apikey').value;
    if (isEdit) Object.assign(existing, server);
    else settings.mcpServers.push(server);
    saveSettings();
    renderMcpList(listEl, settings);
    overlay.remove();
  };
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════
// 通用 UI 工具函数
// ═══════════════════════════════════════

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function createOverlay() {
  const overlay = el('div', 'sat-dialog-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  return overlay;
}

function addCancelButton(dialog, overlay) {
  const actions = el('div', 'sat-dialog-actions');
  const btn = el('button', 'menu_button', '关闭');
  btn.onclick = () => overlay.remove();
  actions.appendChild(btn);
  dialog.appendChild(actions);
}

function addConfirmButtons(dialog, overlay, onConfirm) {
  const actions = el('div', 'sat-dialog-actions');
  const cancelBtn = el('button', 'menu_button', '取消');
  cancelBtn.onclick = () => overlay.remove();
  const okBtn = el('button', 'menu_button', '确认添加');
  okBtn.onclick = () => { onConfirm(); overlay.remove(); };
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialog.appendChild(actions);
}

function renderCheckboxList(container, fields, showPreview = false) {
  const checkboxes = [];
  for (const field of fields) {
    const row = el('div', 'sat-checkbox-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `sat-pick-${field.id}`;
    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    lbl.innerHTML = escHtml(field.label) + (showPreview && field.preview ? `<span class="sat-preview"> ${escHtml(field.preview)}</span>` : '');
    if (field.enabled === false) {
      row.style.opacity = '0.5';
      lbl.innerHTML += ' <span class="sat-disabled-tag">(禁用)</span>';
    }
    row.appendChild(cb);
    row.appendChild(lbl);
    container.appendChild(row);
    checkboxes.push([field, cb]);
  }
  return checkboxes;
}

function showInputDialog(title, placeholder) {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const dialog = el('div', 'sat-dialog');
    dialog.innerHTML = `<h3>${escHtml(title)}</h3>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole';
    input.placeholder = placeholder;
    input.style.width = '100%';
    dialog.appendChild(input);
    const actions = el('div', 'sat-dialog-actions');
    const cancelBtn = el('button', 'menu_button', '取消');
    cancelBtn.onclick = () => { overlay.remove(); resolve(null); };
    const okBtn = el('button', 'menu_button', '确认');
    okBtn.onclick = () => { overlay.remove(); resolve(input.value.trim() || null); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    input.focus();
  });
}

export function showAgentPromptDialog() {
  return showInputDialog('Agent 指令', '输入你的问题或指令...');
}

// ─── 设置面板辅助 ───

function createSection(title, expanded, buildBody) {
  const section = el('div', `sat-settings-section${expanded ? ' expanded' : ''}`);
  const h4 = el('h4', '', title);
  h4.onclick = () => section.classList.toggle('expanded');
  const body = el('div', 'sat-section-body');
  buildBody(body);
  section.appendChild(h4);
  section.appendChild(body);
  return section;
}

function createSelectRow(label, key, value, options) {
  const row = el('div', 'sat-row');
  row.appendChild(el('label', '', label));
  const select = document.createElement('select');
  select.className = 'text_pole';
  select.dataset.key = key;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value; o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  row.appendChild(select);
  return row;
}

function createTextRow(label, key, value, placeholder) {
  const row = el('div', 'sat-row');
  row.appendChild(el('label', '', label));
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'text_pole'; input.dataset.key = key;
  input.value = value || ''; if (placeholder) input.placeholder = placeholder;
  row.appendChild(input);
  return row;
}

function createPasswordRow(label, key, value) {
  const row = el('div', 'sat-row');
  row.appendChild(el('label', '', label));
  const input = document.createElement('input');
  input.type = 'password'; input.className = 'text_pole'; input.dataset.key = key;
  input.value = value || ''; input.placeholder = '••••••••';
  row.appendChild(input);
  return row;
}

function createNumberRow(label, key, value, min, max) {
  const row = el('div', 'sat-row');
  row.appendChild(el('label', '', label));
  const input = document.createElement('input');
  input.type = 'number'; input.className = 'text_pole'; input.dataset.key = key;
  input.value = value; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max;
  row.appendChild(input);
  return row;
}

function createRangeRow(label, key, value, min, max, step) {
  const row = el('div', 'sat-row');
  row.appendChild(el('label', '', label));
  const range = document.createElement('input');
  range.type = 'range'; range.dataset.key = key; range.value = value; range.min = min; range.max = max; range.step = step;
  const display = el('span', '', String(value));
  display.style.minWidth = '36px'; display.style.textAlign = 'right';
  range.addEventListener('input', () => { display.textContent = range.value; });
  row.appendChild(range); row.appendChild(display);
  return row;
}

function createCheckboxRow(label, key, checked) {
  const row = el('div', 'sat-checkbox-row');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.dataset.key = key; cb.checked = checked;
  cb.id = `sat-cfg-${key.replace(/\./g, '-')}`;
  const lbl = document.createElement('label');
  lbl.textContent = label; lbl.htmlFor = cb.id;
  row.appendChild(cb); row.appendChild(lbl);
  return row;
}

function wireSettingsListeners(container, settings) {
  container.addEventListener('change', (e) => {
    const target = e.target;
    const key = target.dataset?.key;
    if (!key) return;
    let value;
    if (target.type === 'checkbox') value = target.checked;
    else if (target.type === 'number' || target.type === 'range') value = parseFloat(target.value);
    else value = target.value;
    setNestedValue(settings, key, value);
    saveSettings();

    if (key === 'apiMode') {
      const c = container.querySelector('#sat-custom-api-fields');
      const s = container.querySelector('#sat-st-api-fields');
      if (c) c.style.display = value === 'custom' ? 'block' : 'none';
      if (s) s.style.display = value === 'st-api' ? 'block' : 'none';
    }
  });
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]]) cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
}
