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
 *   - ページ読み込み時に自動で最新データを取得・マージする。
 *   - データ変更時は2.5秒後に自動でアップロード（push、まとめて送信）。
 *   - 同期は「まるごと上書き」ではなく、項目（id）単位でマージする。
 *     配列データ（リマインダー等）は id ごとに更新日時が新しい方を採用し、
 *     どちらか片方にしか無い項目はそのまま残す＝2台の未同期な追加が
 *     お互いを消し合わない。削除だけは「削除済み記録（tombstone）」を
 *     残して、マージ時に復活しないようにしている。
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
  const TOMBSTONE_KEY = 'life_sync_tombstones';

  let gisReady     = false;
  let tokenClient  = null;
  let accessToken  = null;
  let pushTimer    = null;
  let suppress     = false;
  let pulledOnLoad = false;
  let silentRefreshTried = false;
  let refreshPromise = null;
  let refreshResolve = null;

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
      // 編集中に裏で走る自動保存なので、リモート側の変更があってもリロードはしない
      _mergeAndSync(false).catch(e => console.warn('[Sync] auto push failed:', e));
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
          if (refreshResolve) { refreshResolve(false); refreshResolve = null; }
          return;
        }
        accessToken = resp.access_token;
        rawSetItem(TOKEN_KEY, accessToken);
        rawSetItem(EXPIRY_KEY, String(Date.now() + (Number(resp.expires_in) || 3600) * 1000));
        _updateUI();

        if (refreshResolve) {
          // サイレント再認証待ちのリクエストがあれば、それに結果を返すだけ
          // （呼び出し元が改めてpull/pushをリトライする）。
          refreshResolve(true);
          refreshResolve = null;
          return;
        }

        try {
          await mergeSync();
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
      await mergeSync();
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

  function _parseJSON(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function _itemTimestamp(item) {
    return (item && (item.updatedAt || item.createdAt || item.deletedAt)) || '';
  }

  // id が同じ項目は更新日時が新しい方を採用しつつ、片方にしか無い項目は
  // そのまま残す（＝2台の未同期な追加・編集がお互いを消し合わない）。
  function _mergeArraysById(localArr, remoteArr) {
    const map = new Map();
    for (const item of localArr) {
      if (item && item.id != null) map.set(item.id, item);
    }
    for (const item of remoteArr) {
      if (!item || item.id == null) continue;
      const existing = map.get(item.id);
      if (!existing || _itemTimestamp(item) > _itemTimestamp(existing)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  // localRaw/remoteRaw は { "life_xxx": "JSON文字列" } の形。
  // 配列データは id 単位でマージし、削除済み(tombstone)の項目は除外する。
  // 配列以外（習慣チェックの状態など）は全体の更新日時で新しい方を採用する。
  function _mergeData(localRaw, remoteRaw, remoteNewer) {
    const localTomb  = _parseJSON(localRaw[TOMBSTONE_KEY], []);
    const remoteTomb = _parseJSON(remoteRaw[TOMBSTONE_KEY], []);
    const mergedTomb = _mergeArraysById(
      Array.isArray(localTomb) ? localTomb : [],
      Array.isArray(remoteTomb) ? remoteTomb : []
    );
    const tombMap = new Map(mergedTomb.map(t => [`${t.targetKey}::${t.targetId}`, t.deletedAt]));

    const keys = new Set([...Object.keys(localRaw), ...Object.keys(remoteRaw)]);
    const result = {};

    for (const key of keys) {
      if (key === TOMBSTONE_KEY) {
        result[key] = JSON.stringify(mergedTomb);
        continue;
      }
      const lRaw = localRaw[key];
      const rRaw = remoteRaw[key];
      if (lRaw === undefined) { result[key] = rRaw; continue; }
      if (rRaw === undefined) { result[key] = lRaw; continue; }
      if (lRaw === rRaw) { result[key] = lRaw; continue; }

      const lVal = _parseJSON(lRaw, undefined);
      const rVal = _parseJSON(rRaw, undefined);

      if (Array.isArray(lVal) && Array.isArray(rVal)) {
        const merged = _mergeArraysById(lVal, rVal).filter(item => {
          const deletedAt = tombMap.get(`${key}::${item.id}`);
          // 削除後にさらに更新された（＝削除を上書きする再編集があった）場合のみ残す
          return !deletedAt || _itemTimestamp(item) > deletedAt;
        });
        result[key] = JSON.stringify(merged);
      } else {
        result[key] = remoteNewer ? rRaw : lRaw;
      }
    }
    return result;
  }

  /* --------------------------------------------------
   * Google Drive API 呼び出し
   * -------------------------------------------------- */
  function _silentRefresh() {
    if (!tokenClient) return Promise.resolve(false);
    if (refreshPromise) return refreshPromise;
    refreshPromise = new Promise((resolve) => { refreshResolve = resolve; })
      .finally(() => { refreshPromise = null; });
    tokenClient.requestAccessToken({ prompt: '' });
    return refreshPromise;
  }

  async function _driveFetch(url, opts = {}, retried = false) {
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 401 && !retried) {
      // トークン切れ → バックグラウンドで再認証を試みて1回だけリトライ
      const refreshed = await _silentRefresh();
      if (refreshed) return _driveFetch(url, opts, true);
    }
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

  async function _uploadPayload(fileId, payload) {
    const body = JSON.stringify(payload);
    if (fileId) {
      await _driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }
      );
      return fileId;
    }
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
    return json.id;
  }

  async function push() {
    if (!accessToken) return;
    const payload = { updatedAt: new Date().toISOString(), data: _collectData() };
    const fileId = await _findFileId();
    await _uploadPayload(fileId, payload);
    rawSetItem(LOCAL_TS_KEY, payload.updatedAt);
    rawSetItem(LAST_KEY, payload.updatedAt);
    _updateUI();
  }

  function mergeSync() {
    return _mergeAndSync(true);
  }

  // リモートのデータを取得し、id単位でローカルとマージしてから
  // 必要な分だけローカルに反映／Driveに書き戻す。
  async function _mergeAndSync(reload) {
    if (!accessToken) return;
    const fileId = await _findFileId();
    const localRaw = _collectData();

    if (!fileId) {
      await push();
      return;
    }

    const res = await _driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const remote = await res.json();
    const remoteRaw = (remote && remote.data) || {};
    const localUpdated  = localStorage.getItem(LOCAL_TS_KEY) || '1970-01-01T00:00:00.000Z';
    const remoteUpdated = remote.updatedAt || '1970-01-01T00:00:00.000Z';
    const remoteNewer   = remoteUpdated > localUpdated;

    const merged    = _mergeData(localRaw, remoteRaw, remoteNewer);
    const mergedStr  = JSON.stringify(merged);
    const localStr   = JSON.stringify(localRaw);
    const remoteStr  = JSON.stringify(remoteRaw);
    const localChanged = mergedStr !== localStr;

    if (localChanged) {
      suppress = true;
      try {
        for (const [k, v] of Object.entries(merged)) {
          if (localStorage.getItem(k) !== v) rawSetItem(k, v);
        }
      } finally {
        suppress = false;
      }
    }

    if (mergedStr !== remoteStr) {
      const payload = { updatedAt: new Date().toISOString(), data: merged };
      await _uploadPayload(fileId, payload);
      rawSetItem(LOCAL_TS_KEY, payload.updatedAt);
      rawSetItem(LAST_KEY, payload.updatedAt);
    } else {
      rawSetItem(LOCAL_TS_KEY, remoteUpdated);
      rawSetItem(LAST_KEY, new Date().toISOString());
    }

    if (localChanged && reload) location.reload();
  }

  async function syncNow() {
    if (!accessToken) { signIn(); return; }
    try {
      await mergeSync();
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

  return { gisLoaded, signIn, signOut, isSignedIn, push, mergeSync, syncNow };
})();
