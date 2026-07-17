class AIContentLogger {
  constructor() {
    this.model = this.detectModel();
    this.startTime = null;
    this.init();
  }

  detectModel() {
    const url = window.location.href;
    if (url.includes('gemini.google.com')) return 'Gemini';
    if (url.includes('claude.ai')) return 'Claude';
    if (url.includes('chat.mistral.ai')) return 'Mistral';
    if (url.includes('openai.com')) return 'OpenAI';
    if (url.includes('anthropic.com')) return 'Anthropic';
    if (url.includes('deepseek.com')) return 'DeepSeek';
    if (url.includes('perplexity.ai')) return 'Perplexity';
    if (url.includes('copilot.microsoft.com')) return 'Copilot';
    return 'Unknown';
  }

  init() {
    this.captureFormSubmissions();
    this.interceptFetch();
    this.interceptXHR();
    this.monitorDOMChanges();
    this.captureFileUploads();
    this.setupKeyboardShortcuts();
    this.captureExistingConversations();
  }

  captureFormSubmissions() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!form) return;
      const queryInput = form.querySelector('input[type="text"], textarea');
      if (queryInput && queryInput.value) {
        this.logInteraction(queryInput.value, 'form_submit');
        this.startTime = Date.now();
      }
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        const target = event.target;
        if (target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text'))) {
          setTimeout(() => {
            if (target.value && !target.value.includes('\n')) {
              this.logInteraction(target.value, 'enter_key');
              this.startTime = Date.now();
            }
          }, 100);
        }
      }
    });
  }

  interceptFetch() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const [url, options] = args;
      if (this.isAIEndpoint(url)) {
        const requestBody = options?.body;
        if (requestBody) {
          try {
            const bodyText = await this.getBodyText(requestBody);
            if (bodyText) {
              this.logInteraction(bodyText, 'fetch_request');
              this.startTime = Date.now();
            }
          } catch (e) {
            console.debug('Unable to read fetch body:', e);
          }
        }
      }

      const response = await originalFetch(...args);
      if (this.isAIEndpoint(url)) {
        try {
          const clonedResponse = response.clone();
          const text = await clonedResponse.text();
          const json = this.safeJsonParse(text);
          const responseContent = this.extractResponseContent(json) || text;
          if (responseContent) {
            this.logResponse(responseContent, 'fetch_response');
          }
        } catch (e) {
          // ignore
        }
      }
      return response;
    };
  }

  interceptXHR() {
    const OriginalXHR = window.XMLHttpRequest;
    const self = this;

    function WrappedXHR() {
      const xhr = new OriginalXHR();
      let method = '';
      let url = '';

      const originalOpen = xhr.open;
      const originalSend = xhr.send;

      xhr.open = function (...args) {
        method = args[0];
        url = args[1];
        return originalOpen.apply(this, args);
      };

      xhr.send = function (body) {
        if (self.isAIEndpoint(url)) {
          try {
            const bodyText = self.getBodyTextFromXHR(body);
            if (bodyText) {
              self.logInteraction(bodyText, 'xhr_request');
              self.startTime = Date.now();
            }
          } catch (e) {
            console.debug('Unable to read XHR body:', e);
          }
        }

        this.addEventListener('load', function () {
          if (self.isAIEndpoint(url)) {
            try {
              const text = this.responseText;
              const json = self.safeJsonParse(text);
              const responseContent = self.extractResponseContent(json) || text;
              if (responseContent) {
                self.logResponse(responseContent, 'xhr_response');
              }
            } catch (e) {
              // ignore
            }
          }
        });

        return originalSend.apply(this, [body]);
      };

      return xhr;
    }

    window.XMLHttpRequest = WrappedXHR;
  }

  monitorDOMChanges() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const messages = this.findNewMessages(node);
          if (messages.length > 0) {
            messages.forEach((msg) => {
              if (this.isLikelyAIResponse(msg)) {
                this.logResponse(msg, 'dom_change');
              } else if (this.isLikelyUserQuery(msg)) {
                this.logInteraction(msg, 'dom_change');
              }
            });
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  captureFileUploads() {
    document.addEventListener('change', (event) => {
      const input = event.target;
      if (!input || input.type !== 'file') return;
      const files = Array.from(input.files || []);
      files.forEach((file) => this.logFileUpload(file));
    });

    document.addEventListener('drop', (event) => {
      const files = Array.from(event.dataTransfer?.files || []);
      files.forEach((file) => this.logFileUpload(file));
    });
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        chrome.runtime.sendMessage({ type: 'SHOW_PRESET_QUERIES' });
      }
    });
  }

  captureExistingConversations() {
    setTimeout(() => {
      const existingMessages = this.findAllMessages();
      if (existingMessages.length > 0) {
        existingMessages.forEach((msg) => {
          if (this.isLikelyAIResponse(msg)) {
            this.logResponse(msg, 'existing', true);
          }
        });
      }
    }, 2000);
  }

  isAIEndpoint(url) {
    if (typeof url !== 'string') return false;
    const endpoints = [
      '/api/chat',
      '/api/conversation',
      '/v1/chat/completions',
      '/generate',
      '/stream',
      '/api/messages',
      '/completion'
    ];
    return endpoints.some((endpoint) => url.includes(endpoint));
  }

  async getBodyText(body) {
    if (typeof body === 'string') return body;
    if (body instanceof FormData) {
      return Array.from(body.entries())
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
    }
    if (body instanceof Blob) return await body.text();
    if (body instanceof URLSearchParams) return body.toString();
    if (body && typeof body === 'object') return JSON.stringify(body);
    return null;
  }

  getBodyTextFromXHR(body) {
    if (typeof body === 'string') return body;
    if (body instanceof FormData) {
      return Array.from(body.entries())
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
    }
    return null;
  }

  safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  extractResponseContent(json) {
    if (!json) return null;
    if (json.choices && json.choices[0] && json.choices[0].message) return json.choices[0].message.content;
    if (json.choices && json.choices[0] && json.choices[0].text) return json.choices[0].text;
    if (json.content) return json.content;
    if (json.response) return json.response;
    if (json.text) return json.text;
    if (json.message) return json.message;
    return null;
  }

  findNewMessages(node) {
    const selectors = [
      '.message',
      '.chat-message',
      '.response',
      '.assistant-message',
      '.ai-message',
      '[role="assistant"]',
      '.bot-message',
      '.prose'
    ];
    const messages = [];
    selectors.forEach((selector) => {
      const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
      elements.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 5) messages.push(text);
      });
    });
    return messages;
  }

  findAllMessages() {
    const selectors = [
      '.message',
      '.chat-message',
      '.response',
      '.assistant-message',
      '.ai-message',
      '[role="assistant"]',
      '.bot-message'
    ];
    const messages = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 10) messages.push(text);
      });
    });
    return messages;
  }

  isLikelyAIResponse(text) {
    const aiKeywords = ['AI', 'model', 'based on', 'according to', 'I think', 'I believe'];
    return text.length > 20 && (aiKeywords.some((kw) => text.includes(kw)) || text.includes('```'));
  }

  isLikelyUserQuery(text) {
    return text.length < 200 && (text.includes('?') || text.toLowerCase().includes('what') || text.toLowerCase().includes('how'));
  }

  logInteraction(query, source, isExisting = false) {
    chrome.runtime.sendMessage({
      type: 'LOG_INTERACTION',
      data: {
        model: this.model,
        query,
        source,
        isExisting,
        timestamp: new Date().toISOString()
      }
    });
  }

  logResponse(response, source, isExisting = false) {
    const duration = this.startTime ? Date.now() - this.startTime : null;
    this.startTime = null;
    chrome.runtime.sendMessage({
      type: 'LOG_INTERACTION',
      data: {
        model: this.model,
        response,
        source,
        isExisting,
        duration,
        timestamp: new Date().toISOString()
      }
    });
  }

  logFileUpload(file) {
    chrome.runtime.sendMessage({
      type: 'LOG_FILE_UPLOAD',
      data: {
        filename: file.name,
        filesize: file.size,
        filetype: file.type,
        model: this.model,
        timestamp: new Date().toISOString()
      }
    });
  }
}

new AIContentLogger();
