import { StorageManager } from './storage.js';

class AILogger {
  constructor() {
    this.storage = new StorageManager();
    this.sessions = new Map();
    this.currentSessionId = null;
    this.settings = { enabled: true, presets: [] };
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.currentSessionId = await this.createSession();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this.handleTabChange(activeInfo);
    });

    chrome.windows.onRemoved.addListener(async (windowId) => {
      await this.handleWindowClose(windowId);
    });
  }

  async loadSettings() {
    const data = await this.storage.getAllData();
    this.settings = data.settings || { enabled: true, presets: [] };
  }

  async createSession() {
    const session = {
      id: Date.now().toString(),
      startTime: new Date().toISOString(),
      interactions: [],
      windowCount: 0,
      tabs: new Set()
    };

    this.sessions.set(session.id, session);
    await this.storage.saveSession(session);
    return session.id;
  }

  async handleMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') {
      sendResponse({ success: false, error: 'Invalid message' });
      return;
    }

    if (!this.settings.enabled && message.type.startsWith('LOG_')) {
      sendResponse({ success: false, reason: 'logging_disabled' });
      return;
    }

    switch (message.type) {
      case 'LOG_INTERACTION':
        await this.logInteraction(message.data, sender);
        sendResponse({ success: true });
        break;
      case 'LOG_FILE_UPLOAD':
        await this.logFileAction('upload', message.data, sender);
        sendResponse({ success: true });
        break;
      case 'LOG_FILE_DOWNLOAD':
        await this.logFileAction('download', message.data, sender);
        sendResponse({ success: true });
        break;
      case 'LOG_PRESET_QUERY':
        await this.logPresetQuery(message.data, sender);
        sendResponse({ success: true });
        break;
      case 'GET_SESSION_DATA':
        sendResponse(await this.getSessionData());
        break;
      case 'EXPORT_LOGS':
        await this.exportLogs(message.format);
        sendResponse({ success: true });
        break;
      case 'CLEAR_LOGS':
        await this.clearLogs();
        sendResponse({ success: true });
        break;
      case 'GET_SETTINGS':
        sendResponse({ settings: this.settings });
        break;
      default:
        console.warn('Unknown message:', message);
        sendResponse({ success: false, error: 'unknown_message' });
        break;
    }
  }

  async logInteraction(data, sender) {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;

    const interaction = {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      type: 'interaction',
      model: data.model || 'unknown',
      query: data.query || null,
      response: data.response || null,
      source: data.source || null,
      isExisting: data.isExisting || false,
      duration: data.duration || null,
      tokens: data.tokens || null,
      tabId: sender.tab?.id || null,
      windowId: sender.tab?.windowId || null,
      url: sender.tab?.url || null,
      context: data.context || {}
    };

    session.interactions.push(interaction);
    await this.storage.saveInteraction(interaction);
    this.updateBadge(session.interactions.length);

    if (interaction.tokens && interaction.tokens > 1000) {
      this.showNotification('AI aktivita', `Velký request (${interaction.tokens} tokenů)`);
    }
  }

  async logFileAction(action, data, sender) {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;

    const fileLog = {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      type: `file_${action}`,
      filename: data.filename,
      filesize: data.filesize,
      filetype: data.filetype,
      model: data.model || 'unknown',
      context: data.context || {},
      tabId: sender.tab?.id || null,
      windowId: sender.tab?.windowId || null
    };

    session.interactions.push(fileLog);
    await this.storage.saveInteraction(fileLog);
  }

  async logPresetQuery(data, sender) {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;

    const presetLog = {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      type: 'preset_query',
      name: data.name,
      query: data.query,
      model: data.model || 'unknown',
      category: data.category || 'general',
      tabId: sender.tab?.id || null,
      windowId: sender.tab?.windowId || null
    };

    session.interactions.push(presetLog);
    await this.storage.saveInteraction(presetLog);
  }

  async handleTabChange(activeInfo) {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab?.url && this.isAISite(tab.url)) {
        console.log(`Aktivní AI tab: ${tab.url}`);
      }
    } catch (error) {
      console.warn('Unable to get active tab details', error);
    }
  }

  async handleWindowClose(windowId) {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;

    const interactions = session.interactions.filter((i) => i.windowId === windowId);
    if (interactions.length > 0) {
      console.log(`Zavřeno okno ${windowId} s ${interactions.length} AI interakcemi`);
    }
  }

  async getSessionData() {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return null;

    return {
      sessionId: session.id,
      startTime: session.startTime,
      totalInteractions: session.interactions.length,
      interactions: session.interactions
    };
  }

  async clearLogs() {
    await this.storage.clearAll();
    this.sessions.clear();
    this.currentSessionId = await this.createSession();
    this.updateBadge(0);
  }

  async exportLogs(format = 'json') {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) return;

    let content;
    let filename;
    let mimeType;

    switch (format) {
      case 'csv':
        content = this.convertToCSV(session);
        filename = `ai_logs_${Date.now()}.csv`;
        mimeType = 'text/csv';
        break;
      case 'markdown':
        content = this.convertToMarkdown(session);
        filename = `ai_logs_${Date.now()}.md`;
        mimeType = 'text/markdown';
        break;
      default:
        content = JSON.stringify(session, null, 2);
        filename = `ai_logs_${Date.now()}.json`;
        mimeType = 'application/json';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url,
      filename,
      saveAs: true
    });
  }

  convertToCSV(session) {
    const headers = ['timestamp', 'type', 'model', 'query', 'response', 'filename', 'filesize', 'source', 'duration'];
    const rows = session.interactions.map((i) => [
      i.timestamp,
      i.type,
      i.model || '',
      (i.query || '').replace(/,/g, ';'),
      (i.response || '').replace(/,/g, ';'),
      i.filename || '',
      i.filesize || '',
      i.source || '',
      i.duration || ''
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  convertToMarkdown(session) {
    let md = `# AI Activity Log\n\n`;
    md += `**Session ID:** ${session.id}\n`;
    md += `**Start Time:** ${session.startTime}\n`;
    md += `**Total Interactions:** ${session.interactions.length}\n\n`;
    md += `## Interactions\n\n`;

    session.interactions.forEach((i, index) => {
      md += `### Interaction ${index + 1}\n`;
      md += `- **Time:** ${i.timestamp}\n`;
      md += `- **Type:** ${i.type}\n`;
      md += `- **Model:** ${i.model || 'unknown'}\n`;
      if (i.query) md += `- **Query:** ${i.query}\n`;
      if (i.response) md += `- **Response:** ${i.response.substring(0, 200)}...\n`;
      if (i.filename) md += `- **File:** ${i.filename} (${i.filesize || 'unknown size'})\n`;
      md += '\n';
    });

    return md;
  }

  updateBadge(count) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
  }

  showNotification(title, message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message,
      priority: 1
    });
  }

  isAISite(url) {
    const aiDomains = [
      'gemini.google.com',
      'claude.ai',
      'chat.mistral.ai',
      'openai.com',
      'anthropic.com',
      'deepseek.com',
      'perplexity.ai',
      'copilot.microsoft.com'
    ];
    return aiDomains.some((domain) => url.includes(domain));
  }
}

const logger = new AILogger();
