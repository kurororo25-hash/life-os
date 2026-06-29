/**
 * storage.js - localStorage 読み書きユーティリティ
 * 全ページから読み込んで使う共通モジュール
 */
const Storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  },

  set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },

  add(key, item) {
    const items = this.get(key);
    item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    item.createdAt = new Date().toISOString();
    items.unshift(item);
    this.set(key, items);
    return item;
  },

  update(key, id, updates) {
    const items = this.get(key);
    const idx = items.findIndex(i => i.id === id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() };
      this.set(key, items);
      return items[idx];
    }
    return null;
  },

  remove(key, id) {
    const items = this.get(key).filter(i => i.id !== id);
    this.set(key, items);
  },

  clear(key) {
    localStorage.removeItem(key);
  }
};
