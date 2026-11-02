/**
 * 랭킹 화면 로직 — TAPTAP iTunes 전용
 * 탭: 인기 곡 / 곡 검색 / 내 기록
 * 곡 선택 시 → TOP 20 랭킹 표시 (난이도별)
 * 내 기록 탭에서 곡 선택 시 → 로그인한 계정의 기록만 난이도별로 표시
 */

let currentTrack = null;     // { trackId, title, artist, artwork }
let currentDiff = 'easy';

// 탭 전환
document.querySelectorAll('.rank-tab').forEach(t => {
  t.addEventListener('click', () => switchRankTab(t.dataset.r));
});

function switchRankTab(r) {
  document.querySelectorAll('.rank-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.r === r);
  });
  document.querySelectorAll('.rank-panel').forEach(p => {
    p.style.display = (p.id === 'panel-' + r) ? '' : 'none';
  });
  document.getElementById('ranking-section').style.display = 'none';
  if (r === 'popular') loadPopular();
  else if (r === 'me') loadMe();
}

// 인기 곡 로드 (백엔드)
async function loadPopular() {
  const wrap = document.getElementById('popular-list');
  wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">불러오는 중...</div>';
  try {
    const res = await fetch('/api/scores/tracks?limit=20');
    const data = await res.json();
    if (!data || data.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">아직 플레이된 곡이 없어요.<br>iTunes 탭에서 첫 곡을 플레이해보세요!</div>';
      return;
    }
    wrap.innerHTML = '';
    data.forEach(t => {
      const item = renderTrackItem(t, t.playCount + '회');
      item.addEventListener('click', () => selectTrack(t));
      wrap.appendChild(item);
    });
  } catch (e) {
    wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#ff7788; padding:40px;">목록 불러오기 실패: ' + escapeHtml(e.message) + '</div>';
  }
}

// 내 기록 로드 (인증)
async function loadMe() {
  const wrap = document.getElementById('me-list');
  const token = localStorage.getItem('token');
  if (!token) {
    wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">🔐 로그인 후 이용 가능합니다.</div>';
    return;
  }
  wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">불러오는 중...</div>';
  try {
    const res = await fetch('/api/scores/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('nickname');
      alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
      window.location.href = 'login.html';
      return;
    }
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!data || data.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">아직 플레이 기록이 없어요.</div>';
      return;
    }

    // 같은 곡을 여러 난이도로 쳤으면 카드는 하나만
    const byTrack = new Map();
    data.forEach(r => {
      const key = String(r.trackId);
      if (!byTrack.has(key)) byTrack.set(key, []);
      byTrack.get(key).push(r);
    });

    wrap.innerHTML = '';
    byTrack.forEach(rows => {
      const first = rows[0];
      const badge = rows.length === 1
        ? first.diff.toUpperCase() + ' · ' + (first.score || 0).toLocaleString() + '점'
        : rows.length + '개 난이도';
      const item = renderTrackItem(first, badge);
      item.addEventListener('click', () => showMyRecord(first, rows));
      wrap.appendChild(item);
    });
  } catch (e) {
    wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#ff7788; padding:40px;">내 기록 불러오기 실패</div>';
  }
}

// 검색 (iTunes API 직접)
async function search(term) {
  const wrap = document.getElementById('search-results');
  wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">검색 중...</div>';
  try {
    const res = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=15');
    const d = await res.json();
    const results = (d.results || []).filter(r => r.previewUrl);
    if (results.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#666; padding:40px;">검색 결과가 없습니다.</div>';
      return;
    }
    wrap.innerHTML = '';
    results.forEach(t => {
      const item = renderTrackItem({
        trackId: String(t.trackId),
        trackTitle: t.trackName,
        trackArtist: t.artistName,
        trackArtwork: t.artworkUrl100 || t.artworkUrl60 || ''
      }, t.primaryGenreName || '');
      item.addEventListener('click', () => selectTrack({
        trackId: String(t.trackId),
        trackTitle: t.trackName,
        trackArtist: t.artistName,
        trackArtwork: t.artworkUrl100 || t.artworkUrl60 || ''
      }));
      wrap.appendChild(item);
    });
  } catch (e) {
    wrap.innerHTML = '<div class="empty-state" style="text-align:center; color:#ff7788; padding:40px;">검색 실패</div>';
  }
}

document.getElementById('search-btn').addEventListener('click', () => {
  const v = document.getElementById('search-input').value.trim();
  if (v) search(v);
});
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) search(v);
  }
});

function renderTrackItem(t, badge) {
  const div = document.createElement('div');
  div.className = 'track-item';
  div.innerHTML =
    '<img src="' + escapeHtml(t.trackArtwork || '') + '" alt="">' +
    '<div class="info">' +
      '<div class="title">' + escapeHtml(t.trackTitle || '?') + '</div>' +
      '<div class="artist">' + escapeHtml(t.trackArtist || '?') + '</div>' +
    '</div>' +
    '<div class="play-count">' + escapeHtml(badge || '') + '</div>';
  return div;
}

// 선택한 곡 정보 카드
function renderSelectedInfo(title, artist, artwork) {
  document.getElementById('selected-track-info').innerHTML =
    '<img src="' + escapeHtml(artwork || '') + '">' +
    '<div><div style="color:#fff;font-weight:700;font-size:17px;">' + escapeHtml(title) + '</div>' +
    '<div style="color:#aaa;font-size:13px;">' + escapeHtml(artist) + '</div></div>';
}

function showRankingSection() {
  const section = document.getElementById('ranking-section');
  section.style.display = '';
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 내 기록 탭: 그 곡의 "내" 기록만 난이도별로 보여주기 (다른 사람 기록 X)
function showMyRecord(track, myRows) {
  currentTrack = null; // 전체 랭킹은 불러오지 않음
  renderSelectedInfo(track.trackTitle, track.trackArtist, track.trackArtwork);

  document.querySelector('.diff-tabs').style.display = 'none';
  document.querySelector('#ranking-table th').textContent = '난이도';

  const me = localStorage.getItem('nickname') || localStorage.getItem('username') || '나';
  const order = { easy: 0, normal: 1, hard: 2 };
  const rows = [...myRows].sort((a, b) => (order[a.diff] ?? 9) - (order[b.diff] ?? 9));

  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const d = document.createElement('td'); d.className = 'rank-num'; d.textContent = row.diff.toUpperCase();
    const n = document.createElement('td'); n.textContent = me;
    const s = document.createElement('td'); s.textContent = (row.score || 0).toLocaleString() + '점';
    const a = document.createElement('td'); a.textContent = (row.accuracy || 0) + '%';
    const g = document.createElement('td');
    const gs = document.createElement('span'); gs.className = 'grade-cell'; gs.textContent = row.grade || '-';
    g.appendChild(gs);
    tr.append(d, n, s, a, g);
    tbody.appendChild(tr);
  });

  showRankingSection();
}

// 곡 선택 -> 전체 랭킹 표시 (인기 곡 / 곡 검색 탭)
function selectTrack(track) {
  // 내 기록 화면에서 바꿔 둔 표시를 원래대로
  document.querySelector('.diff-tabs').style.display = '';
  document.querySelector('#ranking-table th').textContent = '순위';

  currentTrack = {
    trackId: String(track.trackId),
    title: track.trackTitle || track.title,
    artist: track.trackArtist || track.artist,
    artwork: track.trackArtwork || track.artwork
  };
  renderSelectedInfo(currentTrack.title, currentTrack.artist, currentTrack.artwork);
  showRankingSection();
  loadRanking();
}

// 난이도 탭
document.querySelectorAll('.diff-tab').forEach(t => {
  t.addEventListener('click', () => {
    currentDiff = t.dataset.d;
    document.querySelectorAll('.diff-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active', t.dataset.d);
    t.classList.add(currentDiff);
    loadRanking();
  });
});

// TOP 20 로드
async function loadRanking() {
  if (!currentTrack) return;
  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">불러오는 중...</td></tr>';
  try {
    const res = await fetch('/api/scores/ranking?trackId=' + encodeURIComponent(currentTrack.trackId) + '&diff=' + encodeURIComponent(currentDiff));
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">이 난이도에 아직 기록이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    data.forEach((row, i) => {
      const tr = document.createElement('tr');
      const r = document.createElement('td'); r.className = 'rank-num'; r.textContent = (i+1) + '위';
      const n = document.createElement('td'); n.textContent = row.username;
      const s = document.createElement('td'); s.textContent = (row.score || 0).toLocaleString() + '점';
      const a = document.createElement('td'); a.textContent = (row.accuracy || 0) + '%';
      const g = document.createElement('td');
      const gs = document.createElement('span'); gs.className = 'grade-cell'; gs.textContent = row.grade || '-';
      g.appendChild(gs);
      tr.appendChild(r); tr.appendChild(n); tr.appendChild(s); tr.appendChild(a); tr.appendChild(g);
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#ff7788;">랭킹 불러오기 실패</td></tr>';
  }
}

document.getElementById('home-btn').addEventListener('click', () => {
  window.location.href = 'select.html';
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// 초기 진입
window.addEventListener('DOMContentLoaded', () => loadPopular());