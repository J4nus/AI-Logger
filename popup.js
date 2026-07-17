const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const logsContainer = document.getElementById('logsContainer');
const interactionCount = document.getElementById('interactionCount');
const totalInteractions = document.getElementById('totalInteractions');
const totalSessions = document.getElementById('totalSessions');
const modelsCount = document.getElementById('modelsCount');
const modelStats = document.getElementById('modelStats');
const typeStats = document.getElementById('typeStats');
const exportJson = document.getElementById('exportJson');
const exportCsv = document.getElementById('exportCsv');
const exportMd = document.getElementById('exportMd');
const clearLogs = document.getElementById('clearLogs');
const presetList = document.getElementById('presetList');
const openOptions = document.getElementById('openOptions');

function selectTab(tabName) {
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  tabContents.forEach((content) => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
});

async function fetchSessionData() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA' }, (data) => {
      resolve(data);
    });
  });
}

async function renderLogs() {
  const session = await fetchSessionData();
  if (!session || !session.interactions.length) {
    logsContainer.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>Zatím žádné logy</h3><p>Začněte komunikovat s AI modely a logy se objeví zde.</p></div>';
    interactionCount.textContent = '0';
    return;
  }

  interactionCount.textContent = session.interactions.length.toString();
  logsContainer.innerHTML = session.interactions
    .slice()
    .reverse()
    .map((interaction) => {
      const summary = interaction.query || interaction.response || interaction.filename || interaction.type;
      return `
        <div class="log-item">
          <div class="time">${new Date(interaction.timestamp).toLocaleString()}</div>
          <div>
            <span class="model">${interaction.model || 'unknown'}</span>
            <span class="type">${interaction.type}</span>
          </div>
          <div class="content-text">${escapeHtml(summary || '')}</div>
        </div>
      `;
    })
    .join('');
}

async function renderStats() {
  const session = await fetchSessionData();
  const interactions = session?.interactions || [];
  const models = new Set();
  const modelCount = {};
  const typeCount = {};

  interactions.forEach((item) => {
    const model = item.model || 'unknown';
    models.add(model);
    modelCount[model] = (modelCount[model] || 0) + 1;
    const type = item.type || 'unknown';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  totalInteractions.textContent = interactions.length.toString();
  totalSessions.textContent = '1';
  modelsCount.textContent = models.size.toString();

  modelStats.innerHTML = Object.entries(modelCount)
    .map(([key, value]) => `<div class="stat-row"><strong>${escapeHtml(key)}</strong>: ${value}</div>`)
    .join('');
  typeStats.innerHTML = Object.entries(typeCount)
    .map(([key, value]) => `<div class="stat-row"><strong>${escapeHtml(key)}</strong>: ${value}</div>`)
    .join('');
}

async function renderPresets() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || { presets: [] };
    const presets = settings.presets || [];
    if (!presets.length) {
      presetList.innerHTML = '<div class="empty-state"><div class="icon">⚡</div><h3>Žádné presety</h3><p>Přidejte je v nastavení, aby bylo možno rychle odesílat připravené dotazy.</p></div>';
      return;
    }

    presetList.innerHTML = presets
      .map((preset) => `
        <div class="preset-item">
          <div><strong>${escapeHtml(preset.name)}</strong></div>
          <div class="preset-text">${escapeHtml(preset.query)}</div>
          <button class="btn btn-success btn-small" data-query="${encodeURIComponent(preset.query)}" data-name="${encodeURIComponent(preset.name)}">Odeslat</button>
        </div>
      `)
      .join('');

    presetList.querySelectorAll('button[data-query]').forEach((button) => {
      button.addEventListener('click', () => {
        const query = decodeURIComponent(button.dataset.query);
        const name = decodeURIComponent(button.dataset.name);
        chrome.runtime.sendMessage({ type: 'LOG_PRESET_QUERY', data: { name, query, model: 'preset' } });
      });
    });
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function exportLogs(format) {
  chrome.runtime.sendMessage({ type: 'EXPORT_LOGS', format });
}

function clearAllLogs() {
  chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }, () => {
    renderLogs();
    renderStats();
  });
}

openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

exportJson.addEventListener('click', () => exportLogs('json'));
exportCsv.addEventListener('click', () => exportLogs('csv'));
exportMd.addEventListener('click', () => exportLogs('markdown'));
clearLogs.addEventListener('click', clearAllLogs);

window.addEventListener('load', async () => {
  renderLogs();
  renderStats();
  renderPresets();
});
