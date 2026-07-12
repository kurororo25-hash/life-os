/**
 * google-calendar.js - Googleカレンダー連携
 *
 * 必要な事前準備:
 *   1. Google Cloud Console でプロジェクトを作成
 *   2. Google Calendar API を有効化
 *   3. OAuth 2.0 クライアントID（ウェブアプリ）を作成
 *   4. アプリのURLを「承認済みのJavaScriptオリジン」に追加
 *   5. リマインダー画面の 📅 ボタン → 設定 → クライアントIDを貼り付け
 *
 * HTTPS環境 または localhost でのみ動作します（file:// は不可）。
 */

const GCal = (() => {
  const SCOPES      = 'https://www.googleapis.com/auth/calendar.events';
  const DISCOVERY   = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
  const HARDCODED_CLIENT_ID = '306443567956-en4g26uhd8s8lpme7r0d9ha37aqehm9o.apps.googleusercontent.com';
  const STORAGE_KEY = 'gcal_client_id';
  const TOKEN_KEY   = 'gcal_token';

  let gapiReady   = false;
  let gisReady    = false;
  let tokenClient = null;
  let accessToken = null;

  /* --------------------------------------------------
   * 初期化
   * -------------------------------------------------- */
  function gapiLoaded() {
    gapi.load('client', async () => {
      const clientId = _getClientId();
      if (!clientId) { gapiReady = true; _updateUI(); return; }
      try {
        await gapi.client.init({ discoveryDocs: [DISCOVERY] });
        gapiReady = true;
        _tryRestoreToken();
        _updateUI();
      } catch (e) {
        console.warn('[GCal] gapi init failed:', e);
        gapiReady = true;
        _updateUI();
      }
    });
  }

  function gisLoaded() {
    gisReady = true;
    const clientId = _getClientId();
    if (!clientId) { _updateUI(); return; }
    _initTokenClient(clientId);
    _updateUI();
  }

  function _initTokenClient(clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) { console.warn('[GCal] token error:', resp); return; }
        accessToken = resp.access_token;
        gapi.client.setToken({ access_token: accessToken });
        localStorage.setItem(TOKEN_KEY, accessToken);
        _updateUI();
        renderGCalEvents();
      }
    });
  }

  function _tryRestoreToken() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && gapi.client) {
      accessToken = saved;
      gapi.client.setToken({ access_token: saved });
    }
  }

  /* --------------------------------------------------
   * サインイン / サインアウト
   * -------------------------------------------------- */
  function signIn() {
    const clientId = _getClientId();
    if (!clientId) { openSetup(); return; }
    if (!gapiReady || !gisReady) {
      showToast('Google APIの読み込み中です。少し待ってから再試行してください。');
      return;
    }
    if (!tokenClient) _initTokenClient(clientId);
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function signOut() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    if (gapi.client) gapi.client.setToken(null);
    _updateUI();
    const panel = document.getElementById('gcalEventsPanel');
    if (panel) panel.innerHTML =
      '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">ログインするとカレンダーが表示されます</div>';
  }

  function isSignedIn() { return !!accessToken; }

  /* --------------------------------------------------
   * UIの更新
   * -------------------------------------------------- */
  function _updateUI() {
    const signInBtn  = document.getElementById('gcalSignInBtn');
    const signOutBtn = document.getElementById('gcalSignOutBtn');
    const status     = document.getElementById('gcalStatus');
    const syncRow    = document.getElementById('gcalSyncRow');
    if (!signInBtn) return;

    const clientId = _getClientId();
    if (!clientId) {
      signInBtn.textContent = '⚙️ 設定して連動する';
      signInBtn.onclick = openSetup;
      signOutBtn.classList.add('hidden');
      if (status)  status.textContent = '未設定';
      if (syncRow) syncRow.style.display = 'none';
      return;
    }

    if (accessToken) {
      signInBtn.classList.add('hidden');
      signOutBtn.classList.remove('hidden');
      if (status)  status.textContent = '✅ 接続中';
      if (syncRow) syncRow.style.display = 'flex';
    } else {
      signInBtn.classList.remove('hidden');
      signInBtn.textContent = 'Googleでログイン';
      signInBtn.onclick = () => GCal.signIn();
      signOutBtn.classList.add('hidden');
      if (status)  status.textContent = '';
      if (syncRow) syncRow.style.display = 'none';
    }
  }

  /* --------------------------------------------------
   * カレンダーイベント取得・表示
   * -------------------------------------------------- */
  async function renderGCalEvents() {
    const panel = document.getElementById('gcalEventsPanel');
    if (!panel) return;
    if (!accessToken) {
      panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">ログインするとカレンダーが表示されます</div>';
      return;
    }
    panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">読み込み中...</div>';
    try {
      const now    = new Date().toISOString();
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await gapi.client.calendar.events.list({
        calendarId:  'primary',
        timeMin:      now,
        timeMax:      future,
        showDeleted:  false,
        singleEvents: true,
        maxResults:   30,
        orderBy:      'startTime'
      });
      const events = res.result.items || [];
      if (events.length === 0) {
        panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">今後30日のイベントはありません</div>';
        return;
      }
      panel.innerHTML = events.map(ev => {
        const start   = ev.start.dateTime || ev.start.date;
        const dateStr = start.slice(0, 10);
        const timeStr = ev.start.dateTime
          ? new Date(ev.start.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
          : '終日';
        return `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">
          <div style="font-size:11px;color:var(--text-muted);min-width:72px;flex-shrink:0">${formatDate(dateStr)}<br>${timeStr}</div>
          <div style="font-size:13px;flex:1;line-height:1.4">${esc(ev.summary || '（タイトルなし）')}</div>
        </div>`;
      }).join('');
    } catch (e) {
      console.warn('[GCal] fetch error:', e);
      if (e.status === 401) {
        accessToken = null;
        localStorage.removeItem(TOKEN_KEY);
        _updateUI();
        panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--danger);font-size:13px">セッションが切れました。再度ログインしてください。</div>';
      } else {
        panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--danger);font-size:13px">読み込み失敗。再試行してください。</div>';
      }
    }
  }

  /* --------------------------------------------------
   * リマインダー → Googleカレンダーに同期
   * -------------------------------------------------- */
  async function syncAll(reminders) {
    if (!accessToken) { showToast('先にGoogleにログインしてください'); return; }
    let ok = 0, fail = 0;
    for (const r of reminders) {
      try {
        const { start, end } = _buildStartEnd(r.date, r.time);
        await gapi.client.calendar.events.insert({
          calendarId: 'primary',
          resource: {
            summary:     r.title,
            description: r.notes || '',
            start,
            end
          }
        });
        ok++;
      } catch (e) {
        console.warn('[GCal] sync error:', e);
        fail++;
      }
    }
    showToast(fail === 0
      ? `${ok}件をGoogleカレンダーに追加しました`
      : `${ok}件成功、${fail}件失敗しました`);
    renderGCalEvents();
  }

  /* --------------------------------------------------
   * 設定モーダル
   * -------------------------------------------------- */
  function openSetup() {
    const overlay = document.getElementById('gcalSetupOverlay');
    if (!overlay) return;
    const input = document.getElementById('gcalClientIdInput');
    if (input) input.value = _getClientId();
    overlay.classList.remove('hidden');
  }

  function closeSetup() {
    const overlay = document.getElementById('gcalSetupOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function saveClientId() {
    const input = document.getElementById('gcalClientIdInput');
    const val   = (input?.value || '').trim();
    if (!val) { alert('クライアントIDを入力してください'); return; }
    if (!val.includes('.apps.googleusercontent.com')) {
      alert('クライアントIDの形式が正しくないようです。\n例：123456789-abc.apps.googleusercontent.com');
      return;
    }
    localStorage.setItem(STORAGE_KEY, val);
    closeSetup();
    showToast('保存しました。ページを再読み込みします...');
    setTimeout(() => location.reload(), 1000);
  }

  function _getClientId() {
    return localStorage.getItem(STORAGE_KEY) || HARDCODED_CLIENT_ID;
  }

  /* --------------------------------------------------
   * リマインダー1件をGoogleカレンダーに追加（保存時の自動同期用）
   * -------------------------------------------------- */
  function _buildStartEnd(date, time) {
    if (time) {
      const [h, m] = time.split(':').map(Number);
      const totalMin = h * 60 + m + 30;
      const endH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
      const endM = String(totalMin % 60).padStart(2, '0');
      return {
        start: { dateTime: `${date}T${time}:00`, timeZone: 'Asia/Tokyo' },
        end:   { dateTime: `${date}T${endH}:${endM}:00`, timeZone: 'Asia/Tokyo' }
      };
    }
    return {
      start: { date },
      end:   { date }
    };
  }

  async function syncReminder(reminder) {
    if (!accessToken || !reminder.date) return;
    try {
      const { start, end } = _buildStartEnd(reminder.date, reminder.time);
      const res = await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary:     reminder.title,
          description: reminder.notes || '',
          start,
          end
        }
      });
      Storage.update('life_reminders', reminder.id, { gcalEventId: res.result.id });
      showToast('Googleカレンダーにも追加しました 📅');
    } catch (e) {
      console.warn('[GCal] syncReminder failed:', e);
    }
  }

  /* --------------------------------------------------
   * タイムボクシング → Googleカレンダーに同期
   * （開始・終了時刻を直接指定できる版）
   * -------------------------------------------------- */
  function _buildStartEndRange(date, startTime, endTime) {
    return {
      start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Tokyo' },
      end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'Asia/Tokyo' }
    };
  }

  async function syncTimeboxItem(item, silent) {
    if (!accessToken || !item.date) return;
    try {
      const { start, end } = _buildStartEndRange(item.date, item.startTime, item.endTime);
      const res = await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary: item.title,
          start,
          end
        }
      });
      Storage.update('life_timebox', item.id, { gcalEventId: res.result.id });
      if (!silent) showToast('Googleカレンダーにも追加しました 📅');
    } catch (e) {
      console.warn('[GCal] syncTimeboxItem failed:', e);
    }
  }

  async function syncTimeboxItems(items) {
    if (!accessToken) return;
    const targets = items.filter(item => item && item.date);
    for (const item of targets) {
      await syncTimeboxItem(item, true);
    }
    if (targets.length > 1) {
      showToast(`${targets.length}件をGoogleカレンダーにも追加しました 📅`);
    } else if (targets.length === 1) {
      showToast('Googleカレンダーにも追加しました 📅');
    }
  }

  async function syncAllTimebox(items) {
    if (!accessToken) { showToast('先にGoogleにログインしてください'); return; }
    let ok = 0, fail = 0;
    for (const item of items) {
      try {
        const { start, end } = _buildStartEndRange(item.date, item.startTime, item.endTime);
        const res = await gapi.client.calendar.events.insert({
          calendarId: 'primary',
          resource: {
            summary: item.title,
            start,
            end
          }
        });
        Storage.update('life_timebox', item.id, { gcalEventId: res.result.id });
        ok++;
      } catch (e) {
        console.warn('[GCal] sync error:', e);
        fail++;
      }
    }
    showToast(fail === 0
      ? `${ok}件をGoogleカレンダーに追加しました`
      : `${ok}件成功、${fail}件失敗しました`);
    renderGCalEvents();
  }

  /* --------------------------------------------------
   * 公開API
   * -------------------------------------------------- */
  return { gapiLoaded, gisLoaded, signIn, signOut, isSignedIn, openSetup, closeSetup, saveClientId, renderGCalEvents, syncAll, syncReminder, syncTimeboxItem, syncTimeboxItems, syncAllTimebox };
})();
