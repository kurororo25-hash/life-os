/**
 * sw.js - Service Worker
 * 通知の受信・表示を担当する。index.html から登録される。
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// 通知をタップした時：アプリを開く
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('life-os') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});

// OneSignal などの Push イベント用（② で使う）
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || '生活OS', {
      body:  data.body  || '',
      icon:  './icon.png',
      badge: './icon.png',
      data
    })
  );
});
