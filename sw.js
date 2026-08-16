/**
 * sw.js - Service Worker
 * 通知の受信・表示に加えて、オフラインでもアプリを開けるようアプリ本体をキャッシュする。
 * ファイル構成を変えたら CACHE_VERSION を上げると古いキャッシュが破棄される。
 */

const CACHE_VERSION = 'life-os-v2';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/common.js',
  './js/sync.js',
  './js/google-calendar.js',
  './js/notifications.js',
  './icon.png',
  './pages/reminder.html',
  './pages/timebox.html',
  './pages/lifelog.html',
  './pages/maintenance.html',
  './pages/habit.html',
  './pages/monthly.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// 同一オリジンのGETリクエストはネットワーク優先、失敗時（オフライン）はキャッシュから返す
// Google関連の外部リクエスト（ログイン・カレンダー同期）はキャッシュせずそのまま通す
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

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
