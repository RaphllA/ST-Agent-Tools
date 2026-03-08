/**
 * ST Agent Tools - MCP Client
 * Supports Streamable HTTP (recommended) and SSE transports.
 * Browser-only, no stdio support.
 */

const MODULE_NAME = 'ST-Agent-Tools';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const REQUEST_TIMEOUT_MS = 30000;

export class McpClient {
  constructor(serverConfig) {
    this.config = serverConfig; // { id, name, url, transport, enabled, apiKey, headers }
    this.state = 'disconnected'; // disconnected | connecting | connected | error
    this.tools = [];
    this.sessionId = null;
    this._nextId = 1;
    // SSE-specific
    this._eventSource = null;
    this._postEndpoint = null;
    this._pendingRequests = new Map(); // id -> { resolve, reject, timer }
  }

  // ─── Public API ───

  async connect() {
    this.state = 'connecting';
    try {
      if (this.config.transport === 'sse') {
        await this._connectSSE();
      } else {
        // streamable-http (default)
        await this._connectStreamableHTTP();
      }
      this.state = 'connected';
    } catch (err) {
      this.state = 'error';
      throw err;
    }
  }

  async listTools() {
    const result = await this._send('tools/list', {});
    this.tools = result.tools || [];
    return this.tools;
  }

  async callTool(name, args) {
    return this._send('tools/call', { name, arguments: args });
  }

  disconnect() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
    }
    this._pendingRequests.clear();
    this.state = 'disconnected';
    this.sessionId = null;
  }

  // ─── Streamable HTTP Transport ───

  async _connectStreamableHTTP() {
    const result = await this._sendStreamableHTTP('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ST-Agent-Tools', version: '0.1.0' },
    });

    // Send initialized notification
    await this._sendStreamableHTTPNotification('notifications/initialized', {});

    return result;
  }

  async _sendStreamableHTTP(method, params) {
    const id = this._nextId++;
    const body = { jsonrpc: '2.0', method, params, id };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this._authHeaders(),
      ...(this.config.headers || {}),
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Capture session ID
      const newSessionId = response.headers.get('Mcp-Session-Id');
      if (newSessionId) this.sessionId = newSessionId;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`MCP HTTP ${response.status}: ${errText.slice(0, 300)}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        return this._parseSSEStream(response, id);
      } else {
        const result = await response.json();
        if (result.error) {
          throw new Error(`MCP error: ${result.error.message || JSON.stringify(result.error)}`);
        }
        return result.result;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async _sendStreamableHTTPNotification(method, params) {
    const body = { jsonrpc: '2.0', method, params };
    const headers = {
      'Content-Type': 'application/json',
      ...this._authHeaders(),
      ...(this.config.headers || {}),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    try {
      await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      // Notifications are fire-and-forget
    }
  }

  async _parseSSEStream(response, expectedId) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          try {
            const msg = JSON.parse(dataStr);
            if (msg.id === expectedId) {
              if (msg.error) {
                throw new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`);
              }
              return msg.result;
            }
          } catch (e) {
            if (e.message?.startsWith('MCP error:')) throw e;
            // Ignore parse errors for non-matching messages
          }
        }
      }
    }

    throw new Error('MCP: SSE stream ended without response');
  }

  // ─── SSE Transport (Legacy) ───

  async _connectSSE() {
    const sseUrl = this.config.url.replace(/\/+$/, '') + '/sse';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._eventSource?.close();
        reject(new Error('SSE connection timeout'));
      }, 15000);

      this._eventSource = new EventSource(sseUrl);

      this._eventSource.addEventListener('endpoint', (event) => {
        try {
          this._postEndpoint = new URL(event.data, this.config.url).href;
        } catch {
          this._postEndpoint = event.data;
        }
        clearTimeout(timer);

        // Send initialize
        this._sendSSE('initialize', {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'ST-Agent-Tools', version: '0.1.0' },
        }).then((result) => {
          // Send initialized notification
          this._sendSSENotification('notifications/initialized', {});
          resolve(result);
        }).catch(reject);
      });

      this._eventSource.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id !== undefined && this._pendingRequests.has(msg.id)) {
            const pending = this._pendingRequests.get(msg.id);
            this._pendingRequests.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.error) {
              pending.reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        } catch (err) {
          console.warn(`[${MODULE_NAME}] SSE parse error:`, err);
        }
      });

      this._eventSource.onerror = () => {
        clearTimeout(timer);
        if (this.state === 'connecting') {
          this._eventSource?.close();
          reject(new Error('SSE connection failed'));
        }
      };
    });
  }

  _sendSSE(method, params) {
    const id = this._nextId++;
    const body = { jsonrpc: '2.0', method, params, id };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`MCP SSE request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this._pendingRequests.set(id, { resolve, reject, timer });

      const headers = {
        'Content-Type': 'application/json',
        ...this._authHeaders(),
        ...(this.config.headers || {}),
      };

      fetch(this._postEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }).catch(err => {
        this._pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  _sendSSENotification(method, params) {
    const body = { jsonrpc: '2.0', method, params };
    const headers = {
      'Content-Type': 'application/json',
      ...this._authHeaders(),
      ...(this.config.headers || {}),
    };

    fetch(this._postEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  // ─── Unified send ───

  async _send(method, params) {
    if (this.config.transport === 'sse') {
      return this._sendSSE(method, params);
    }
    return this._sendStreamableHTTP(method, params);
  }

  // ─── Auth ───

  _authHeaders() {
    const headers = {};
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }
}
