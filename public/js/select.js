/**
 * 곡 선택 화면 로직 (iTunes 전용)
 * 흐름: iTunes 검색 -> 곡 선택 -> 난이도 -> 자동 채보 -> game.html
 */

let selectedTrack = null;

document.querySelectorAll('.source-tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.source));
});

function switchTab(source) {
  document.querySelectorAll('.source-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.source === source);
  });
  document.querySelectorAll('.source-panel').forEach(p => {
    p.style.display = (p.id === 'panel-' + source) ? '' : 'none';
  });
  if (source === 'recommend') loadRecommendations();
}

// iTunes 검색
async function searchITunes(term) {
  setItunesStatus('검색 중...', 'loading');
  try {
    const res = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=15');
    const data = await res.json();
    renderItunesResults(data.results || []);
    if (data.results && data.results.length > 0) {
      setItunesStatus('✅ ' + data.results.length + '곡 — 곡을 선택하면 난이도 화면으로 이동합니다.', 'ok');
    } else {
      setItunesStatus('검색 결과가 없습니다.', 'err');
    }
  } catch (e) {
    setItunesStatus('검색 실패: ' + e.message, 'err');
  }
}

function renderItunesResults(results) {
  const wrap = document.getElementById('itunes-results');
  if (!results.length) {
    wrap.innerHTML = '<div class="empty-state">검색 결과가 없습니다.</div>';
    return;
  }
  wrap.innerHTML = results.map((r, i) => 
    '<div class="itunes-result" data-i="' + i + '">' +
      '<img src="' + escapeHtml(r.artworkUrl60 || '') + '" alt="">' +
      '<div class="info">' +
        '<div class="title">' + escapeHtml(r.trackName || '?') + '</div>' +
        '<div class="artist">' + escapeHtml(r.artistName || '?') + '</div>' +
      '</div>' +
      '<div class="genre-tag">' + escapeHtml(r.primaryGenreName || '?') + '</div>' +
    '</div>'
  ).join('');
  Array.from(wrap.children).forEach((el, i) => {
    el.addEventListener('click', () => selectItunesTrack(results[i]));
  });
}

function selectItunesTrack(track) {
  if (!track.previewUrl) {
    setItunesStatus('이 곡은 미리듣기가 제공되지 않아요. 다른 곡을 골라주세요.', 'err');
    return;
  }
  selectedTrack = track;
  document.getElementById('itunesPreviewArt').src = track.artworkUrl100 || track.artworkUrl60 || '';
  document.getElementById('itunesPreviewTitle').textContent = track.trackName;
  document.getElementById('itunesPreviewArtist').textContent = track.artistName;
  document.getElementById('itunesPreviewGenre').textContent = track.primaryGenreName;
  showStep(2);
}

function quickSearch(term) {
  document.getElementById('itunes-input').value = term;
  searchITunes(term);
}

document.getElementById('itunes-search-btn').addEventListener('click', () => {
  const v = document.getElementById('itunes-input').value.trim();
  if (v) searchITunes(v);
});
document.getElementById('itunes-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) searchITunes(v);
  }
});

// 난이도 선택 -> 자동 채보 -> 게임 시작
async function confirmDiff(diff) {
  if (!selectedTrack) return;
  showStep(3);
  setLoading('음원 다운로드 중...', selectedTrack.trackName + ' - ' + selectedTrack.artistName);

  try {
    const res = await fetch(selectedTrack.previewUrl);
    if (!res.ok) throw new Error('미리듣기 fetch 실패 (' + res.status + ')');
    const arrayBuf = await res.arrayBuffer();

    setLoading('🔬 자동 채보 중 (' + diff.toUpperCase() + ')...', selectedTrack.trackName);
    const { beatmap, duration } = await AutoChart.generate(arrayBuf, diff);

    sessionStorage.setItem('itunesGame', JSON.stringify({
      trackId: selectedTrack.trackId,
      title: selectedTrack.trackName,
      artist: selectedTrack.artistName,
      genre: selectedTrack.primaryGenreName,
      artwork: selectedTrack.artworkUrl100 || selectedTrack.artworkUrl60 || '',
      previewUrl: selectedTrack.previewUrl,
      duration: duration,
      diff: diff,
      beatmap: beatmap,
      noteCount: beatmap.length
    }));

    setLoading('✅ ' + beatmap.length + '개 노트 생성. 게임을 시작합니다...', '');
    setTimeout(() => {
      location.href = 'game.html?diff=' + diff + '&t=' + Date.now();
    }, 600);
  } catch (e) {
    setLoading('❌ 채보 실패: ' + e.message, '다른 곡을 시도해보세요.');
    console.error(e);
    setTimeout(() => showStep(2), 2500);
  }
}

function goBack() {
  showStep(1);
}

// 맞춤 추천 — 서버에 쌓인 플레이 이력(play_history) 기반
async function fetchTrackById(trackId) {
  const r = await fetch('https://itunes.apple.com/lookup?id=' + encodeURIComponent(trackId) + '&entity=song');
  const d = await r.json();
  return (d.results || []).find(t => String(t.trackId) === String(trackId)) || null;
}

// 다시 도전 / 한 단계 위로 카드 클릭 -> 곡 정보를 가져와 바로 그 난이도로 시작
async function startRecommended(item, diff, card) {
  const reasonEl = card.querySelector('.rec-reason');
  const original = reasonEl.textContent;
  reasonEl.textContent = '곡 정보를 불러오는 중...';
  try {
    const track = await fetchTrackById(item.trackId);
    if (!track || !track.previewUrl) throw new Error('미리듣기를 찾지 못했어요.');
    selectedTrack = track;
    confirmDiff(diff);
  } catch (e) {
    reasonEl.textContent = '불러오지 못했어요. 다시 눌러 주세요.';
    setTimeout(() => { reasonEl.textContent = original; }, 2500);
  }
}

async function loadRecommendations() {
  const wrap = document.getElementById('recommend-content');
  const token = localStorage.getItem('token');
  if (!token) {
    wrap.innerHTML = '<div class="empty-state">🔐 로그인 후 곡을 플레이하시면<br>맞춤 추천이 활성화됩니다.</div>';
    return;
  }
  wrap.innerHTML = '<div class="empty-state">추천 곡을 불러오는 중...</div>';

  // 내 이력 기반 추천 (서버)
  let rec = { retry: [], levelup: [], topArtists: [] };
  try {
    const res = await fetch('/api/scores/recommendations', { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 401) {
      ['token', 'username', 'nickname'].forEach(k => localStorage.removeItem(k));
      wrap.innerHTML = '<div class="empty-state">🔐 로그인이 만료됐어요.<br>다시 로그인해 주세요.</div>';
      return;
    }
    if (res.ok) rec = await res.json();
    else console.warn('추천 API 실패', res.status);
  } catch (e) {
    console.warn('추천 API 호출 실패', e);
  }

  // 새로운 곡: 많이 플레이한 아티스트의 곡, 이력이 없으면 인기 K-Pop
  const hasArtists = rec.topArtists && rec.topArtists.length > 0;
  const terms = hasArtists ? rec.topArtists : ['kpop'];
  const perTerm = hasArtists ? 2 : 6;
  const newTracks = [];
  try {
    const results = await Promise.all(terms.map(term =>
      fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=10').then(r => r.json())
    ));
    const seenIds = new Set();
    results.forEach(d => {
      let n = 0;
      (d.results || []).forEach(song => {
        if (n >= perTerm || !song.previewUrl || seenIds.has(song.trackId)) return;
        seenIds.add(song.trackId);
        newTracks.push(song);
        n++;
      });
    });
  } catch (e) {
    console.warn('새로운 곡 fetch 실패', e);
  }

  let html = '';

  if (rec.retry.length) {
    html += '<div class="recommend-section">' +
      '<div class="recommend-title">🔥 다시 도전 — 정확도가 아쉬웠던 곡</div>' +
      '<div class="recommend-row">' +
      rec.retry.map((p, i) => recommendCardPlay(p, 'retry', '지난번 정확도 ' + p.accuracy + '% — 같은 난이도로 다시!', i)).join('') +
      '</div></div>';
  }
  if (rec.levelup.length) {
    html += '<div class="recommend-section">' +
      '<div class="recommend-title">🚀 한 단계 위로 — 다음 난이도 도전</div>' +
      '<div class="recommend-row">' +
      rec.levelup.map((p, i) => recommendCardPlay(p, 'levelup',
        String(p.diff).toUpperCase() + ' ' + p.accuracy + '% → ' + String(p.nextDiff).toUpperCase() + ' 도전!', i)).join('') +
      '</div></div>';
  }
  if (newTracks.length) {
    html += '<div class="recommend-section">' +
      '<div class="recommend-title">' + (hasArtists ? '🆕 새로운 곡 — 자주 플레이한 아티스트' : '🆕 새로운 곡 — iTunes 인기 K-Pop') + '</div>' +
      '<div class="recommend-row">' +
      newTracks.map((s, idx) => recommendCardItunes(s, idx)).join('') +
      '</div></div>';
  }

  if (!html) {
    wrap.innerHTML = '<div class="empty-state">아직 추천할 곡이 없어요.<br>iTunes 탭에서 몇 곡 플레이하고 다시 와주세요!</div>';
    return;
  }

  wrap.innerHTML = html;

  wrap.querySelectorAll('.recommend-card.retry').forEach(card => {
    card.addEventListener('click', () => {
      const item = rec.retry[parseInt(card.dataset.idx)];
      if (item) startRecommended(item, item.diff, card);
    });
  });
  wrap.querySelectorAll('.recommend-card.levelup').forEach(card => {
    card.addEventListener('click', () => {
      const item = rec.levelup[parseInt(card.dataset.idx)];
      if (item) startRecommended(item, item.nextDiff, card);
    });
  });
  wrap.querySelectorAll('.recommend-card.itunes').forEach(card => {
    card.addEventListener('click', () => {
      const track = newTracks[parseInt(card.dataset.idx)];
      if (track) selectItunesTrack(track);
    });
  });
}

function recommendCardPlay(item, category, reason, idx) {
  return '<div class="recommend-card ' + category + '" data-idx="' + idx + '">' +
    '<div class="cat-badge">' + (category === 'retry' ? '🔥 RETRY' : '🚀 LEVEL UP') + '</div>' +
    '<div class="rec-title">' + escapeHtml(item.trackTitle || '(제목 없음)') + '</div>' +
    '<div class="rec-artist">' + escapeHtml(item.trackArtist || '') + ' · ' + escapeHtml(String(item.diff).toUpperCase()) + '</div>' +
    '<div class="rec-reason">' + escapeHtml(reason) + '</div>' +
    '</div>';
}

function recommendCardItunes(track, idx) {
  return '<div class="recommend-card new itunes" data-idx="' + idx + '">' +
    '<div class="cat-badge">🆕 NEW</div>' +
    '<div class="rec-title">' + escapeHtml(track.trackName || '') + '</div>' +
    '<div class="rec-artist">' + escapeHtml(track.artistName || '') + '</div>' +
    '<div class="rec-reason">' + escapeHtml(track.primaryGenreName || '') + ' · 자동 채보</div>' +
    '</div>';
}

// UI 보조
function showStep(n) {
  document.getElementById('step1').style.display = n === 1 ? '' : 'none';
  document.getElementById('step2').style.display = n === 2 ? '' : 'none';
  document.getElementById('step3').style.display = n === 3 ? '' : 'none';
}

function setItunesStatus(msg, type) {
  type = type || '';
  const el = document.getElementById('itunes-status');
  el.className = 'status-msg ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
  el.textContent = msg;
  if (!msg) el.classList.add('hidden');
}

function setLoading(msg, sub) {
  document.getElementById('loading-msg').textContent = msg;
  document.getElementById('loading-sub').textContent = sub || '';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

window.addEventListener('DOMContentLoaded', () => {
  if (location.hash === '#recommend') switchTab('recommend');
  else switchTab('itunes');  // 기본
});
