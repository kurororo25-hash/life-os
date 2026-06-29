/**
 * memo-base.js - メモ系ページ共通ロジック
 * memo-work / memo-study / memo-health / memo-training で共有
 */
function initMemo({ key, icon, label, placeholder }) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <main class="page-main">
      <div class="search-bar">
        <span>🔍</span>
        <input type="text" id="searchInput" placeholder="${label}を検索" oninput="render()">
      </div>
      <div id="listContainer"></div>
    </main>

    <button class="fab" onclick="openModal()">＋</button>

    <div class="modal-overlay hidden" id="modalOverlay" onclick="overlayClick(event)">
      <div class="modal">
        <div class="modal-title">
          <span id="modalTitle">${label}を追加</span>
          <button class="btn-icon" onclick="closeModal()">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">タイトル ＊</label>
          <input type="text" class="form-input" id="fTitle" placeholder="${placeholder || 'タイトル'}">
        </div>
        <div class="form-group">
          <label class="form-label">内容</label>
          <textarea class="form-textarea" id="fContent" style="min-height:140px" placeholder="メモ内容"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">タグ（スペース区切り）</label>
          <input type="text" class="form-input" id="fTags" placeholder="例：重要 大阪駅">
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="fPinned" style="width:18px;height:18px">
          <label for="fPinned" style="font-size:14px;cursor:pointer">📌 ピン留め（上部に固定）</label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
          <button class="btn btn-primary" onclick="saveItem()">保存する</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay hidden" id="detailOverlay" onclick="closeDetail(event)">
      <div class="modal" id="detailModal"></div>
    </div>

    <div id="toast"></div>`;

  let editingId = null;

  window.openModal = function(id) {
    editingId = id || null;
    document.getElementById('modalTitle').textContent = id ? `${label}を編集` : `${label}を追加`;
    document.getElementById('modalOverlay').classList.remove('hidden');
    if (id) {
      const item = Storage.get(key).find(i => i.id === id);
      if (item) {
        document.getElementById('fTitle').value   = item.title   || '';
        document.getElementById('fContent').value = item.content || '';
        document.getElementById('fTags').value    = (item.tags || []).join(' ');
        document.getElementById('fPinned').checked = !!item.pinned;
      }
    } else {
      document.getElementById('fTitle').value    = '';
      document.getElementById('fContent').value  = '';
      document.getElementById('fTags').value     = '';
      document.getElementById('fPinned').checked = false;
    }
    setTimeout(() => document.getElementById('fTitle').focus(), 120);
  };

  window.closeModal = function() {
    document.getElementById('modalOverlay').classList.add('hidden');
    editingId = null;
  };

  window.overlayClick = function(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  };

  window.saveItem = function() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }
    const tagsRaw = document.getElementById('fTags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(/\s+/).filter(Boolean) : [];
    const data = {
      title,
      content: document.getElementById('fContent').value.trim(),
      tags,
      pinned: document.getElementById('fPinned').checked
    };
    if (editingId) {
      Storage.update(key, editingId, data);
      showToast('更新しました ✓');
    } else {
      Storage.add(key, data);
      showToast('追加しました ✓');
    }
    closeModal();
    render();
  };

  window.deleteItem = function(id) {
    if (!confirmDelete('このメモを削除しますか？')) return;
    Storage.remove(key, id);
    showToast('削除しました');
    closeDetail();
    render();
  };

  window.togglePin = function(id) {
    const item = Storage.get(key).find(i => i.id === id);
    if (!item) return;
    Storage.update(key, id, { pinned: !item.pinned });
    showToast(item.pinned ? 'ピン解除しました' : 'ピン留めしました 📌');
    render();
  };

  window.showDetail = function(id) {
    const item = Storage.get(key).find(i => i.id === id);
    if (!item) return;
    const tagsHtml = (item.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
    const contentHtml = esc(item.content || '').replace(/\n/g, '<br>');
    document.getElementById('detailModal').innerHTML = `
      <div class="modal-title">
        <span>${esc(item.title)}</span>
        <button class="btn-icon" onclick="closeDetail()">✕</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${formatDateTime(item.updatedAt || item.createdAt)}</div>
      ${tagsHtml ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">${tagsHtml}</div>` : ''}
      ${item.content ? `<div style="line-height:1.7;white-space:pre-wrap;word-break:break-word;margin-bottom:16px">${contentHtml}</div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeDetail();openModal('${item.id}')">✏️ 編集</button>
        <button class="btn btn-danger" onclick="deleteItem('${item.id}')">🗑️ 削除</button>
      </div>`;
    document.getElementById('detailOverlay').classList.remove('hidden');
  };

  window.closeDetail = function(e) {
    if (!e || e.target === document.getElementById('detailOverlay')) {
      document.getElementById('detailOverlay').classList.add('hidden');
    }
  };

  window.render = function() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    let items = Storage.get(key);
    if (query) {
      items = items.filter(i =>
        i.title.toLowerCase().includes(query) ||
        (i.content || '').toLowerCase().includes(query) ||
        (i.tags || []).some(t => t.toLowerCase().includes(query))
      );
    }

    // ピン留めを上に
    const pinned  = items.filter(i => i.pinned);
    const others  = items.filter(i => !i.pinned);

    const container = document.getElementById('listContainer');
    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon}</div>
          <div class="empty-state-text">${query ? '見つかりません' : `${label}がありません`}</div>
          <div class="empty-state-sub">＋ ボタンで追加できます</div>
        </div>`;
      return;
    }

    function renderGroup(list, title) {
      if (list.length === 0) return '';
      const html = list.map(item => {
        const tagsHtml = (item.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
        const preview = (item.content || '').slice(0, 60).replace(/\n/g, ' ');
        return `
          <div class="list-item" onclick="showDetail('${item.id}')" style="cursor:pointer">
            <div class="list-item-body">
              <div style="display:flex;align-items:center;gap:6px">
                ${item.pinned ? '<span style="color:var(--warning);font-size:14px">📌</span>' : ''}
                <span class="list-item-title">${esc(item.title)}</span>
              </div>
              ${preview ? `<div class="list-item-sub">${esc(preview)}${item.content && item.content.length > 60 ? '…' : ''}</div>` : ''}
              ${tagsHtml ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${tagsHtml}</div>` : ''}
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${formatDateTime(item.updatedAt || item.createdAt)}</div>
            </div>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="event.stopPropagation();togglePin('${item.id}')" title="ピン切替">📌</button>
              <button class="btn-icon" onclick="event.stopPropagation();openModal('${item.id}')">✏️</button>
            </div>
          </div>`;
      }).join('');
      return title ? `<div class="section-title">${title}</div><div class="card">${html}</div>` : `<div class="card">${html}</div>`;
    }

    container.innerHTML =
      renderGroup(pinned, pinned.length > 0 ? '📌 ピン留め' : '') +
      renderGroup(others, pinned.length > 0 && others.length > 0 ? 'その他' : '');
  };

  render();
}
