/**
 * notifications.js - 通知管理
 * index.html から読み込む。Service Worker の登録と通知チェックを行う。
 */

const Notif = {
  // 起動時に呼ぶ
  async init() {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    // Service Worker を登録
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('[Notif] SW 登録失敗:', e);
      return;
    }

    // 許可済みならすぐチェック
    if (Notification.permission === 'granted') {
      this.checkReminders();
      return;
    }

    // まだ未決定なら許可バナーを表示
    if (Notification.permission === 'default') {
      this._showBanner();
    }
  },

  // 許可バナーの「許可する」ボタンから呼ぶ
  async requestPermission() {
    const result = await Notification.requestPermission();
    this._hideBanner();
    if (result === 'granted') {
      this.checkReminders();
    }
  },

  // リマインダーの期限をチェックして通知を出す
  async checkReminders() {
    if (Notification.permission !== 'granted') return;

    const now     = new Date();
    const today   = now.toISOString().slice(0, 10);
    const nowTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const all     = JSON.parse(localStorage.getItem('life_reminders') || '[]');

    // 今日が期限で、時刻未設定 or 時刻を過ぎているものだけ通知
    const dueToday = all.filter(r =>
      !r.done && r.date === today && (!r.time || r.time <= nowTime)
    );
    // 昨日以前の期限切れ
    const overdue = all.filter(r =>
      !r.done && r.date && r.date < today
    );

    const reg = await navigator.serviceWorker.ready;

    if (dueToday.length > 0) {
      reg.showNotification(`⏰ 今日のリマインダー（${dueToday.length}件）`, {
        body:     dueToday.slice(0, 3).map(r => `・${r.time ? r.time + ' ' : ''}${r.title}`).join('\n'),
        icon:     './icon.png',
        tag:      'reminder-today',
        renotify: false
      });
    }

    if (overdue.length > 0) {
      reg.showNotification(`⚠️ 期限切れのリマインダー（${overdue.length}件）`, {
        body:     overdue.slice(0, 3).map(r => `・${r.title}`).join('\n'),
        icon:     './icon.png',
        tag:      'reminder-overdue',
        renotify: false
      });
    }
  },

  _showBanner() {
    const banner = document.getElementById('notifBanner');
    if (banner) banner.classList.remove('hidden');
  },

  _hideBanner() {
    const banner = document.getElementById('notifBanner');
    if (banner) banner.classList.add('hidden');
  }
};
