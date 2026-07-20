/**
 * sync.js - PCとスマホでデータを同期する（Google Drive appDataFolder使用）
 *
 * 必要な事前準備:
 *   1. Google Cloud Console（Googleカレンダー連携と同じプロジェクト）で
 *      「Google Drive API」を有効化する
 *   2. OAuth同意画面のテストユーザーに自分のGoogleアカウントが
 *      登録されていることを確認する（カレンダー連携時に設定済みのはず）
 *
 * 仕組み:
 *   - localStorage の "life_" で始まる全キーを1つのJSONファイルにまとめ、
 *     Googleドライブの「アプリ専用フォルダ（appDataFolder）」に保存する。
 *     このフォルダは本人のドライブ画面には表示されず、このアプリだけが読み書きできる。
 *   - ページ読み込み時に自動で最新データを取得（pull）。
 *   - データ変更時は2.5秒後に自動でアップロード（push、まとめて送信）。
 *   - 更新日時（updatedAt）を比較し、新しい方を採用する単純な方式。
 *     ※同時に2台で同時編集した場合は、後から同期した方の内容で上書きされます。
 *     　基本は「使い終わったら次の端末を触る前に少し待つ」運用を想定。
 */
const Sync = (() => {
  const CLIENT_ID    = '306443567956-en4g26uhd8s8lpme7r0d9ha37aqehm9o.apps.googleusercontent.com';
  const SCOPES       = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME    = 'lifeos-data.json';
  const TOKEN_KEY    = 'sync_token';
  const EXPIRY_KEY   = 'sync_token_expiry';
  const FILE_ID_KEY  = 'sync_file_id';
  const LOCAL_TS_KEY = 'sync_local_updated_at';
  const LAST_KEY     = 'sync_last_synced_at';

  let gisReady     = false;
  let tokenClient  = null;
  let accessToken  = null;
  let pushTimer    = null;
  let suppress     = false;
  let pulledOnLoad = false;
  let silentRefreshTried = false;

  /* --------------------------------------------------
   * localStorage の書き込みをフックして自動push予約
   * -------------------------------------------------- */
  const rawSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    rawSetItem(key, value);
    if (!suppress && key.startsWith('life_')) {
      rawSetItem(LOCAL_TS_KEY, new Date().toISOString());
      _scheduleAutoPush();
    }
  };

  function _scheduleAutoPush() {
    if (!accessToken) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      push().catch(e => console.warn('[Sync] auto push failed:', e));
    }, 2500);
  }

  /* --------------------------------------------------
   * 初期化（GISスクリプト読み込み完了時に呼ばれる）
   * -------------------------------------------------- */
  function gisLoaded() {
    gisReady = true;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) {
          console.warn('[Sync] token error:', resp);
          accessToken = null;
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EXPIRY_KEY);
          _updateUI();
          return;
        }
        accessToken = resp.access_token;
        rawSetItem(TOKEN_KEY, accessToken);
        rawSetItem(EXPIRY_KEY, String(Date.now() + (Number(resp.expires_in) || 3600) * 1000));
        _updateUI();
        try {
          await pullIfNewer();
          if (typeof showToast === 'function') showToast('同期しました 🔄');
        } catch (e) {
          console.warn('[Sync] initial sync failed:', e);
        }
        _updateUI();
      }
    });

    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      accessToken = saved;
      // 期限切れ間近ならバックグラウンド再認証（成功後のcallbackがpullまで行う）。
      // まだ有効そうならそのままpullする。
      const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
      if (Date.now() >= expiry - 5 * 60 * 1000) {
        silentRefreshTried = true;
        tokenClient.requestAccessToken({ prompt: '' });
      } else {
        _autoPullOnLoad();
      }
    }
    _updateUI();
  }

  async function _autoPullOnLoad() {
    if (pulledOnLoad) return;
    pulledOnLoad = true;
    try {
      await pullIfNewer();
    } catch (e) {
      if (e && e.status === 401) {
        if (tokenClient && !silentRefreshTried) {
          // 期限切れ検知 → 一度だけバックグラウンド再認証（成功すればcallback内でpullし直す）
          silentRefreshTried = true;
          tokenClient.requestAccessToken({ prompt: '' });
        } else {
          accessToken = null;
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EXPIRY_KEY);
        }
      } else {
        console.warn('[Sync] auto pull failed:', e);
      }
    }
    _updateUI();
  }

  /* --------------------------------------------------
   * サインイン / サインアウト
   * -------------------------------------------------- */
  function signIn() {
    if (!gisReady) {
      if (typeof showToast === 'function') showToast('読み込み中です。少し待ってから再試行してください。');
      return;
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function signOut() {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    _updateUI();
  }

  function isSignedIn() { return !!accessToken; }

  /* --------------------------------------------------
   * データの収集・適用
   * -------------------------------------------------- */
  function _dataKeys() {
    return Object.keys(localStorage).filter(k => k.startsWith('life_'));
  }

  function _collectData() {
    const data = {};
    for (const k of _dataKeys()) data[k] = localStorage.getItem(k);
    return data;
  }

  function _applyRemote(remote) {
    if (!remote || !remote.data) return;
    suppress = true;
    try {
      for (const [k, v] of Object.entries(remote.data)) {
        localStorage.setItem(k, v);
      }
    } finally {
      suppress = false;
    }
    rawSetItem(LOCAL_TS_KEY, remote.updatedAt || new Date().toISOString());
    rawSetItem(LAST_KEY, new Date().toISOString());
  }

  /* --------------------------------------------------
   * Google Drive API 呼び出し
   * -------------------------------------------------- */
  async function _driveFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const err = new Error('Drive API error ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function _findFileId() {
    const cached = localStorage.getItem(FILE_ID_KEY);
    if (cached) return cached;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await _driveFetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=${q}`
    );
    const json = await res.json();
    const file = (json.files || [])[0];
    if (file) { rawSetItem(FILE_ID_KEY, file.id); return file.id; }
    return null;
  }

  async function push() {
    if (!accessToken) return;
    const payload = { updatedAt: new Date().toISOString(), data: _collectData() };
    const body = JSON.stringify(payload);
    const fileId = await _findFileId();

    if (fileId) {
      await _driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }
      );
    } else {
      const metadata = { name: FILE_NAME, parents: ['appDataFolder'] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([body], { type: 'application/json' }));
      const res = await _driveFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', body: form }
      );
      const json = await res.json();
      rawSetItem(FILE_ID_KEY, json.id);
    }
    rawSetItem(LOCAL_TS_KEY, payload.updatedAt);
    rawSetItem(LAST_KEY, payload.updatedAt);
    _updateUI();
  }

  async function pullIfNewer() {
    if (!accessToken) return;
    const fileId = await _findFileId();
    if (!fileId) { await push(); return; }

    const res = await _driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const remote = await res.json();
    const localUpdated = localStorage.getItem(LOCAL_TS_KEY) || '1970-01-01T00:00:00.000Z';

    if (remote.updatedAt && remote.updatedAt > localUpdated) {
      const changed = JSON.stringify(remote.data) !== JSON.stringify(_collectData());
      _applyRemote(remote);
      if (changed) location.reload();
    } else if (localUpdated > (remote.updatedAt || '')) {
      await push();
    } else {
      rawSetItem(LAST_KEY, new Date().toISOString());
    }
  }

  async function syncNow() {
    if (!accessToken) { signIn(); return; }
    try {
      await pullIfNewer();
      await push();
      if (typeof showToast === 'function') showToast('同期しました 🔄');
    } catch (e) {
      console.warn('[Sync] manual sync failed:', e);
      if (typeof showToast === 'function') showToast('同期に失敗しました');
    }
    _updateUI();
  }

  /* --------------------------------------------------
   * UI更新（ホーム画面に要素がある場合のみ）
   * -------------------------------------------------- */
  function _updateUI() {
    const signInBtn  = document.getElementById('syncSignInBtn');
    const nowBtn     = document.getElementById('syncNowBtn');
    const signOutBtn = document.getElementById('syncSignOutBtn');
    const status     = document.getElementById('syncStatus');
    const lastEl     = document.getElementById('syncLastTime');
    if (!signInBtn) return;

    if (accessToken) {
      signInBtn.classList.add('hidden');
      if (nowBtn) nowBtn.classList.remove('hidden');
      signOutBtn.classList.remove('hidden');
      if (status) status.textContent = '✅ 接続中';
      const last = localStorage.getItem(LAST_KEY);
      if (lastEl) {
        lastEl.textContent = last
          ? `最終同期: ${new Date(last).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
          : '';
      }
    } else {
      signInBtn.classList.remove('hidden');
      if (nowBtn) nowBtn.classList.add('hidden');
      signOutBtn.classList.add('hidden');
      if (status) status.textContent = '未接続';
      if (lastEl) lastEl.textContent = '';
    }
  }

  return { gisLoaded, signIn, signOut, isSignedIn, push, pullIfNewer, syncNow };
})();
