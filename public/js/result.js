/**
 * 리듬 게임 결과 처리 (result.js) — TAPTAP iTunes 전용
 */

const params = new URLSearchParams(window.location.search);
const diff = params.get('diff');
const score = parseInt(params.get('score')) || 0;
const combo = parseInt(params.get('combo')) || 0;
const perfect = parseInt(params.get('perfect')) || 0;
const good = parseInt(params.get('good')) || 0;
const miss = parseInt(params.get('miss')) || 0;

const total = perfect + good + miss;
const accuracy = total > 0 ? Math.round((perfect + good * 0.5) / total * 100) : 0;

function getGrade(acc) {
  if (acc >= 95) return 'S';
  if (acc >= 85) return 'A';
  if (acc >= 70) return 'B';
  if (acc >= 50) return 'C';
  return 'D';
}

const DIFF_NAMES = { easy: '🟢 Easy', normal: '🟡 Normal', hard: '🔴 Hard' };

let trackMeta = {};
try {
  trackMeta = JSON.parse(sessionStorage.getItem('itunesGameResult') || '{}');
} catch (e) {}

const songDisplay = trackMeta.title
  ? (trackMeta.title + (trackMeta.artist ? ' - ' + trackMeta.artist : ''))
  : '(알 수 없는 곡)';

const artSlot = document.getElementById('result-artwork');
if (artSlot && trackMeta.artwork) {
  const img = document.createElement('img');
  img.src = trackMeta.artwork;
  img.alt = trackMeta.title || '';
  img.style.cssText = 'width:120px; height:120px; border-radius:12px; margin-bottom:14px;';
  artSlot.innerHTML = '';
  artSlot.appendChild(img);
}

document.getElementById('result-song').textContent = songDisplay;
document.getElementById('result-diff').textContent = DIFF_NAMES[diff] || diff || '';
document.getElementById('result-score').textContent = score.toLocaleString() + '점';
document.getElementById('result-combo').textContent = combo + 'x';
document.getElementById('result-accuracy').textContent = accuracy + '%';
document.getElementById('result-grade').textContent = getGrade(accuracy);

// 점수 저장 (로그인 시) — 상세 에러 메시지 표시
const token = localStorage.getItem('token');
const saveMsg = document.getElementById('save-msg');

if (token && trackMeta.trackId) {
  const payload = {
    trackId: String(trackMeta.trackId),
    diff: diff,
    score: score,
    combo: combo,
    accuracy: accuracy,
    grade: getGrade(accuracy),
    trackTitle: trackMeta.title || '',
    trackArtist: trackMeta.artist || '',
    trackArtwork: trackMeta.artwork || ''
  };
  console.log('[score POST] payload:', payload);

  fetch('/api/scores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(payload)
  })
  .then(async res => {
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    console.log('[score POST] response status:', res.status, 'body:', data);
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('nickname');
      saveMsg.style.color = '#ff7788';
      saveMsg.textContent = '⚠️ 로그인이 만료되어 점수를 저장하지 못했습니다. 잠시 후 로그인 화면으로 이동합니다.';
      setTimeout(() => { window.location.href = 'login.html'; }, 3000);
      return;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || ('HTTP ' + res.status));
    }
    saveMsg.style.color = '#39ff6e';
    saveMsg.textContent = '✅ 점수가 랭킹에 저장되었습니다!';
  })
  .catch(err => {
    saveMsg.style.color = '#ff7788';
    saveMsg.textContent = '❌ 점수 저장 실패 — ' + err.message;
    console.error('[score POST] error:', err);
  });
} else if (token && !trackMeta.trackId) {
  saveMsg.textContent = '⚠️ 트랙 정보가 없어 저장 불가 (다시 곡 선택부터 시작해주세요).';
} else {
  saveMsg.textContent = '🎮 게스트 모드 - 점수가 저장되지 않습니다.';
}

document.getElementById('retry-btn').addEventListener('click', () => {
  const stillThere = sessionStorage.getItem('itunesGame');
  if (stillThere) {
    window.location.href = 'game.html?diff=' + diff + '&t=' + Date.now();
  } else {
    window.location.href = 'select.html';
  }
});

document.getElementById('home-btn').addEventListener('click', () => {
  window.location.href = 'select.html';
});
