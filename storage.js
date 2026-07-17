export class StorageManager {
  constructor() {
    this.storageKey = 'ai_activity_logs';
    this.maxLogs = 10000;
  }

  async saveSession(session) {
    try {
      const data = await this.getAllData();
      data.sessions = data.sessions || [];
      data.sessions.push(session);
      if (data.sessions.length > 100) {
        data.sessions = data.sessions.slice(-100);
      }
      await this.saveData(data);
      return true;
    } catch (error) {
      console.error('Chyba při ukládání session:', error);
      return false;
    }
  }

  async saveInteraction(interaction) {
    try {
      const data = await this.getAllData();
      data.interactions = data.interactions || [];
      data.interactions.push(interaction);
      if (data.interactions.length > this.maxLogs) {
        data.interactions = data.interactions.slice(-this.maxLogs);
      }
      if (data.currentSession) {
        data.currentSession.interactions = data.currentSession.interactions || [];
        data.currentSession.interactions.push(interaction);
      }
      await this.saveData(data);
      return true;
    } catch (error) {
      console.error('Chyba při ukládání interakce:', error);
      return false;
    }
  }

  async getInteractions(filter = {}) {
    try {
      const data = await this.getAllData();
      let interactions = data.interactions || [];
      if (filter.model) {
        interactions = interactions.filter((i) => i.model === filter.model);
      }
      if (filter.type) {
        interactions = interactions.filter((i) => i.type === filter.type);
      }
      if (filter.fromDate) {
        interactions = interactions.filter((i) => i.timestamp >= filter.fromDate);
      }
      if (filter.toDate) {
        interactions = interactions.filter((i) => i.timestamp <= filter.toDate);
      }
      return interactions;
    } catch (error) {
      console.error('Chyba při načítání interakcí:', error);
      return [];
    }
  }

  async getSessions() {
    try {
      const data = await this.getAllData();
      return data.sessions || [];
    } catch (error) {
      console.error('Chyba při načítání session:', error);
      return [];
    }
  }

  async clearAll() {
    try {
      await this.saveData({
        sessions: [],
        interactions: [],
        currentSession: null,
        settings: { enabled: true, presets: [] }
      });
      return true;
    } catch (error) {
      console.error('Chyba při mazání dat:', error);
      return false;
    }
  }

  async deleteSession(sessionId) {
    try {
      const data = await this.getAllData();
      data.sessions = (data.sessions || []).filter((s) => s.id !== sessionId);
      data.interactions = (data.interactions || []).filter((i) => i.sessionId !== sessionId);
      await this.saveData(data);
      return true;
    } catch (error) {
      console.error('Chyba při mazání session:', error);
      return false;
    }
  }

  async getAllData() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.storageKey], (result) => {
        const data = result[this.storageKey];
        resolve(data || { sessions: [], interactions: [], currentSession: null, settings: { enabled: true, presets: [] } });
      });
    });
  }

  async saveData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.storageKey]: data }, () => {
        resolve();
      });
    });
  }

  async getStats() {
    const data = await this.getAllData();
    const interactions = data.interactions || [];
    const sessions = data.sessions || [];
    const modelStats = {};
    const typeStats = {};
    interactions.forEach((i) => {
      const model = i.model || 'unknown';
      modelStats[model] = (modelStats[model] || 0) + 1;
      const type = i.type || 'unknown';
      typeStats[type] = (typeStats[type] || 0) + 1;
    });
    return {
      totalInteractions: interactions.length,
      totalSessions: sessions.length,
      modelStats,
      typeStats,
      lastInteraction: interactions.length ? interactions[interactions.length - 1].timestamp : null,
      firstInteraction: interactions.length ? interactions[0].timestamp : null
    };
  }
}
