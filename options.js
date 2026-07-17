const enabledCheckbox = document.getElementById('enabled');
const presetsTextarea = document.getElementById('presets');
const saveButton = document.getElementById('saveButton');

function parsePresets(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, query] = line.split('|');
    return { name: name?.trim() || 'Preset', query: query?.trim() || '' };
  }).filter((preset) => preset.query);
}

function formatPresets(presets) {
  return presets.map((preset) => `${preset.name}|${preset.query}`).join('\n');
}

function loadSettings() {
  chrome.storage.local.get(['ai_activity_logs'], (result) => {
    const data = result.ai_activity_logs || { settings: { enabled: true, presets: [] } };
    const settings = data.settings || { enabled: true, presets: [] };
    enabledCheckbox.checked = settings.enabled;
    presetsTextarea.value = formatPresets(settings.presets || []);
  });
}

function saveSettings() {
  const presets = parsePresets(presetsTextarea.value);
  chrome.storage.local.get(['ai_activity_logs'], (result) => {
    const data = result.ai_activity_logs || { sessions: [], interactions: [], currentSession: null, settings: { enabled: true, presets: [] } };
    data.settings = { enabled: enabledCheckbox.checked, presets };
    chrome.storage.local.set({ ai_activity_logs: data }, () => {
      alert('Nastavení uloženo');
    });
  });
}

saveButton.addEventListener('click', saveSettings);
window.addEventListener('load', loadSettings);
