/**
 * common.js - 全ページ共通ユーティリティ
 */

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const dow = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function confirmDelete(msg) {
  return confirm(msg || '削除しますか？\nこの操作は元に戻せません。');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function priorityBadge(priority) {
  const map = {
    high:   ['高', 'badge-high'],
    medium: ['中', 'badge-medium'],
    low:    ['低', 'badge-low']
  };
  const [label, cls] = map[priority] || ['', ''];
  return label ? `<span class="badge ${cls}">${label}</span>` : '';
}

function repeatLabel(repeat) {
  const map = {
    none:        '',
    daily:       '毎日',
    weekly:      '毎週',
    monthly:     '毎月',
    'weekly-sun': '毎週日',
    'weekly-mon': '毎週月',
    'weekly-tue': '毎週火',
    'weekly-wed': '毎週水',
    'weekly-thu': '毎週木',
    'weekly-fri': '毎週金',
    'weekly-sat': '毎週土'
  };
  return map[repeat] || '';
}

function moodLabel(mood) {
  return { great: '最高', good: 'よかった', neutral: 'ふつう', bad: 'つらい' }[mood] || '';
}
