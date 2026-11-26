/**
 * 마이페이지 — /api/scores/me/summary 한 번으로 화면을 그린다.
 * 곡 제목·닉네임 등 외부에서 온 문자열은 textContent 로만 넣어서 HTML 로 해석되지 않게 한다.
 */
const GRADES = ['S', 'A', 'B', 'C', 'D'];
const DIFFS = [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']];

const token = localStorage.getItem('token');
if (!token) {
  window.location.replace('login.html');
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function isHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function card(title) {
  const c = el('div', 'card');
  c.appendChild(el('h2', '', title));
  return c;
}

function bars(rows, total) {
  const box = el('div');
  rows.forEach(([label, cnt]) => {
    const row = el('div', 'bar-row');
    row.appendChild(el('div', 'bar-label', label));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = (total > 0 ? Math.round((cnt / total) * 100) : 0) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'bar-cnt', String(cnt)));
    box.appendChild(row);
  });
  return box;
}

function trackItem(t, showTime) {
  const item = el('div', 'item');
  if (isHttp(t.trackArtwork)) {
    const img = el('img');
    img.src = t.trackArtwork;
    img.alt = '';
    item.appendChild(img);
  } else {
    item.appendChild(el('div', 'ph'));
  }
  const info = el('div', 'info');
  info.appendChild(el('div', 't', t.trackTitle || '(제목 없음)'));
  info.appendChild(el('div', 'a', (t.trackArtist || '') + ' · ' + String(t.diff).toUpperCase()));
  item.appendChild(info);

  const meta = el('div', 'meta');
  meta.appendChild(el('div', 'score', Number(t.score).toLocaleString()));
  const g = el('span', 'grade ' + (GRADES.includes(t.grade) ? t.grade : ''), t.grade);
  meta.appendChild(g);
  meta.appendChild(document.createTextNode(' ' + t.accuracy + '%'));
  if (showTime && t.playedAt) {
    meta.appendChild(el('div', '', new Date(t.playedAt).toLocaleString('ko-KR')));
  }
  item.appendChild(meta);
  return item;
}

function renderProfile(data) {
  const c = el('div', 'card');
  const row = el('div', 'profile');

  const avatar = el('div', 'avatar');
  if (isHttp(data.profileImage)) {
    const img = el('img');
    img.src = data.profileImage;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = '👤';
  }
  row.appendChild(avatar);

  const right = el('div');
  const nickRow = el('div', 'nick-row');
  const nickEl = el('div', 'nick', data.nickname);
  nickRow.appendChild(nickEl);
  const editBtn = el('button', 'small-btn', '닉네임 변경');
  nickRow.appendChild(editBtn);
  right.appendChild(nickRow);

  const edit = el('div', 'nick-edit');
  const input = el('input');
  input.type = 'text';
  input.maxLength = 10;
  input.placeholder = '새 닉네임';
  const save = el('button', 'small-btn', '저장');
  const cancel = el('button', 'small-btn', '취소');
  edit.appendChild(input);
  edit.appendChild(save);
  edit.appendChild(cancel);
  right.appendChild(edit);
  const msg = el('div', 'nick-msg');
  right.appendChild(msg);

  editBtn.addEventListener('click', () => {
    input.value = nickEl.textContent;
    edit.style.display = 'flex';
    msg.textContent = '';
    input.focus();
  });
  cancel.addEventListener('click', () => { edit.style.display = 'none'; msg.textContent = ''; });
  save.addEventListener('click', async () => {
    const nickname = input.value.trim();
    if (!/^[가-힣a-zA-Z0-9]{2,10}$/.test(nickname)) {
      msg.className = 'nick-msg';
      msg.textContent = '닉네임은 한글, 영문, 숫자로 2~10자여야 합니다.';
      return;
    }
    save.disabled = true;
    try {
      const res = await fetch('/api/auth/nickname', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ nickname })
      });
      const body = await res.json();
      if (!res.ok) {
        msg.className = 'nick-msg';
        msg.textContent = body.error || '변경에 실패했어요.';
      } else {
        localStorage.setItem('nickname', body.nickname);
        nickEl.textContent = body.nickname;
        edit.style.display = 'none';
        msg.className = 'nick-msg ok';
        msg.textContent = '닉네임을 바꿨어요.';
      }
    } catch (e) {
      msg.className = 'nick-msg';
      msg.textContent = '서버 오류가 발생했어요.';
    }
    save.disabled = false;
  });

  row.appendChild(right);
  c.appendChild(row);
  return c;
}

function render(data) {
  const root = document.getElementById('content');
  root.textContent = '';
  root.appendChild(renderProfile(data));

  // 요약 카드
  const sum = card('내 플레이 요약');
  const stats = el('div', 'stats');
  [[String(data.totalPlays), '총 플레이'], [data.avgAccuracy + '%', '평균 정확도'], [String(data.bests.length), '도전한 곡·난이도']]
    .forEach(([n, l]) => {
      const s = el('div', 'stat');
      s.appendChild(el('div', 'num', n));
      s.appendChild(el('div', 'lbl', l));
      stats.appendChild(s);
    });
  sum.appendChild(stats);
  root.appendChild(sum);

  if (data.totalPlays === 0) {
    const c = card('아직 플레이 기록이 없어요');
    c.appendChild(el('div', 'empty', '게임을 한 판 하면 여기에 기록이 쌓여요.'));
    root.appendChild(c);
    return;
  }

  const g = card('등급 분포');
  g.appendChild(bars(GRADES.map(k => [k, data.gradeDist[k] || 0]), data.totalPlays));
  root.appendChild(g);

  const d = card('난이도별 플레이');
  d.appendChild(bars(DIFFS.map(([k, label]) => [label, data.diffCounts[k] || 0]), data.totalPlays));
  root.appendChild(d);

  const b = card('곡별 내 베스트');
  const bl = el('div', 'list');
  data.bests.forEach(t => bl.appendChild(trackItem(t, false)));
  b.appendChild(bl);
  root.appendChild(b);

  const r = card('최근 플레이');
  const rl = el('div', 'list');
  data.recent.forEach(t => rl.appendChild(trackItem(t, true)));
  r.appendChild(rl);
  root.appendChild(r);
}

async function load() {
  const root = document.getElementById('content');
  try {
    const res = await fetch('/api/scores/me/summary', { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 401) {
      ['token', 'username', 'nickname'].forEach(k => localStorage.removeItem(k));
      window.location.replace('login.html');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(await res.json());
  } catch (e) {
    root.textContent = '';
    root.appendChild(el('div', 'err', '마이페이지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'));
  }
}

if (token) load();
