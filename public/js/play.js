/**
 * 리듬 게임 핵심 실행 로직 (play.js) — TAPTAP
 * iTunes 전용: sessionStorage('itunesGame') 에서 비트맵 + previewUrl 사용
 */

const KEYS = ['q', 'w', 'o', 'p'];
const LANE_COLORS = ['#ff4dbb', '#ffe033', '#39ff6e', '#bf5fff'];
const JUDGE_POSITION = window.innerHeight * 0.8 - 80;

let score = 0;
let combo = 0;
let maxCombo = 0;
let perfect = 0;
let good = 0;
let miss = 0;
let gameStarted = false;
let isPaused = false;
let syncLoopInterval = null;
let noteIndex = 0;
let activeNotes = [];

const params = new URLSearchParams(window.location.search);
const diff = (params.get('diff') || 'normal').toLowerCase();

let gameMeta = {
  diff: diff, trackId: '', title: '', artist: '', artwork: '',
  duration: 30
};

let beatmap = [];
let audio = null;
let NOTE_TRAVEL_TIME = 0;

const SPEEDS = { easy: 3, normal: 5, hard: 8 };
const speed = SPEEDS[diff] || 5;

function loadGameData() {
  const raw = sessionStorage.getItem('itunesGame');
  if (!raw) {
    alert('게임 데이터가 없어요. 곡 선택 화면으로 돌아갑니다.');
    location.href = 'select.html';
    return false;
  }
  const g = JSON.parse(raw);
  gameMeta.trackId = g.trackId;
  gameMeta.title = g.title;
  gameMeta.artist = g.artist;
  gameMeta.artwork = g.artwork || '';
  gameMeta.duration = g.duration || 30;
  beatmap = g.beatmap || [];
  audio = new Audio(g.previewUrl);
  audio.volume = 0.8;
  audio.addEventListener('ended', endGame);
  NOTE_TRAVEL_TIME = (JUDGE_POSITION + 30) / speed * 16 / 1000;
  return true;
}

function spawnNote(laneIndex) {
  const lane = document.getElementById('lane-' + laneIndex);
  if (!lane) return;
  const note = document.createElement('div');
  note.classList.add('note');
  note.style.top = '-30px';
  note.style.background = LANE_COLORS[laneIndex];
  note.style.boxShadow = '0 0 8px ' + LANE_COLORS[laneIndex] + ', 0 0 20px ' + LANE_COLORS[laneIndex];
  lane.appendChild(note);
  activeNotes.push({ el: note, lane: laneIndex, top: -30 });
}

function gameTick() {
  if (isPaused) return;
  const currentTime = audio.currentTime;

  while (noteIndex < beatmap.length) {
    const b = beatmap[noteIndex];
    if (currentTime >= b.time - NOTE_TRAVEL_TIME) {
      spawnNote(b.lane);
      noteIndex++;
    } else break;
  }

  for (let i = activeNotes.length - 1; i >= 0; i--) {
    const n = activeNotes[i];
    n.top += speed;
    n.el.style.top = n.top + 'px';
    if (n.top > JUDGE_POSITION + 10) {
      n.el.remove();
      activeNotes.splice(i, 1);
      miss++;
      combo = 0;
      showJudge('MISS', 'gray');
      updateUI();
    }
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (gameStarted && !isPaused) pauseGame();
    return;
  }
  if (!gameStarted || isPaused) return;

  const laneIndex = KEYS.indexOf(e.key.toLowerCase());
  if (laneIndex === -1) return;

  const keyEl = document.getElementById('key-' + laneIndex);
  if (keyEl) keyEl.classList.add('active');

  let closest = null, closestIdx = -1, minDist = Infinity;
  for (let i = 0; i < activeNotes.length; i++) {
    const n = activeNotes[i];
    if (n.lane !== laneIndex) continue;
    const d = Math.abs(n.top - JUDGE_POSITION);
    if (d < minDist) { minDist = d; closest = n; closestIdx = i; }
  }
  if (!closest) return;

  if (minDist < 30)      processHit(closest, closestIdx, 100, 'PERFECT', '#FFD700', 'perfect');
  else if (minDist < 60) processHit(closest, closestIdx, 50,  'GOOD',    '#00FF00', 'good');
});

function processHit(note, idx, points, text, color, type) {
  note.el.remove();
  activeNotes.splice(idx, 1);
  score += points;
  combo++;
  if (type === 'perfect') perfect++; else good++;
  if (combo > maxCombo) maxCombo = combo;
  showJudge(text, color);
  updateUI();
}

document.addEventListener('keyup', (e) => {
  const laneIndex = KEYS.indexOf(e.key.toLowerCase());
  if (laneIndex === -1) return;
  const keyEl = document.getElementById('key-' + laneIndex);
  if (keyEl) keyEl.classList.remove('active');
});

function showJudge(text, color) {
  const el = document.getElementById('judge-text');
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = 1;
  el.textContent = text;
  el.style.color = color;
  void el.offsetWidth;
  el.style.transition = 'opacity 0.5s';
  setTimeout(() => { el.style.opacity = 0; }, 300);
}

function updateUI() {
  document.getElementById('score').textContent = score;
  document.getElementById('combo').textContent = combo;
}

function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  audio.play().catch(err => console.error('오디오 오류:', err));
  syncLoopInterval = setInterval(gameTick, 16);
}

function endGame() {
  if (syncLoopInterval) { clearInterval(syncLoopInterval); syncLoopInterval = null; }
  const total = perfect + good + miss;
  const accuracy = total > 0 ? Math.round((perfect + good * 0.5) / total * 100) : 0;

  // 최근 플레이 기록 (추천용)
  try {
    const recent = JSON.parse(localStorage.getItem('recentPlays') || '[]');
    recent.push({
      trackId: gameMeta.trackId,
      title: gameMeta.title,
      artist: gameMeta.artist,
      diff: gameMeta.diff,
      score: score,
      accuracy: accuracy,
      ts: Date.now()
    });
    if (recent.length > 50) recent.splice(0, recent.length - 50);
    localStorage.setItem('recentPlays', JSON.stringify(recent));
  } catch (e) { console.warn(e); }

  // 결과 화면용 트랙 정보
  sessionStorage.setItem('itunesGameResult', JSON.stringify({
    trackId: gameMeta.trackId,
    title: gameMeta.title,
    artist: gameMeta.artist,
    artwork: gameMeta.artwork
  }));

  setTimeout(() => {
    location.href = 'result.html?diff=' + gameMeta.diff +
      '&score=' + score + '&combo=' + maxCombo +
      '&perfect=' + perfect + '&good=' + good + '&miss=' + miss;
  }, 500);
}

// 일시정지 / 재개
const pauseOverlay = document.createElement('div');
pauseOverlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.75); flex-direction:column; align-items:center; justify-content:center; z-index:9999; color:white; font-family:sans-serif;';
pauseOverlay.innerHTML =
  '<div style="font-size:36px; font-weight:bold; margin-bottom:32px;">⏸ 일시정지</div>' +
  '<button id="resume-btn" style="margin-bottom:16px; padding:14px 48px; font-size:20px; border-radius:8px; border:none; background:#28a745; color:white; cursor:pointer;">▶ 다시 돌아가기</button>' +
  '<button id="home-btn" style="padding:14px 48px; font-size:20px; border-radius:8px; border:none; background:#dc3545; color:white; cursor:pointer;">🏠 곡 선택으로</button>';
document.body.appendChild(pauseOverlay);

const countdownEl = document.createElement('div');
countdownEl.style.cssText = 'display:none; position:fixed; inset:0; align-items:center; justify-content:center; z-index:10000; color:white; font-size:120px; font-weight:bold; font-family:sans-serif;';
document.body.appendChild(countdownEl);

function pauseGame() {
  if (!gameStarted || isPaused) return;
  isPaused = true;
  audio.pause();
  pauseOverlay.style.display = 'flex';
}

function resumeGame() {
  pauseOverlay.style.display = 'none';
  let count = 3;
  countdownEl.style.display = 'flex';
  countdownEl.textContent = count;
  const timer = setInterval(() => {
    count--;
    if (count > 0) countdownEl.textContent = count;
    else {
      clearInterval(timer);
      countdownEl.style.display = 'none';
      isPaused = false;
      audio.play().catch(() => {});
    }
  }, 1000);
}

document.getElementById('resume-btn').addEventListener('click', resumeGame);
document.getElementById('home-btn').addEventListener('click', () => {
  if (audio) audio.pause();
  if (syncLoopInterval) clearInterval(syncLoopInterval);
  window.location.href = 'select.html';
});

window.addEventListener('load', () => {
  if (!loadGameData()) return;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999; cursor:pointer; color:white; font-family:sans-serif; padding: 0 24px; text-align: center;';
  overlay.innerHTML =
    (gameMeta.artwork ? '<img src="' + gameMeta.artwork + '" style="width:140px; height:140px; border-radius:14px; margin-bottom:24px;">' : '') +
    '<div style="font-size:28px; font-weight:bold; margin-bottom:6px;">' + escapeStr(gameMeta.title) + '</div>' +
    '<div style="font-size:16px; color:#aaa; margin-bottom:24px;">' + escapeStr(gameMeta.artist) + '</div>' +
    '<div style="font-size:22px; color:#fff;">클릭해서 시작</div>' +
    '<div style="font-size:13px; color:#666; margin-top:18px;">노트 ' + beatmap.length + '개 · 난이도 ' + diff.toUpperCase() + ' · iTunes 자동 채보</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => { overlay.remove(); startGame(); }, { once: true });
});

function escapeStr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
