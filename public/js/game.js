/**
 * index.html 동작 — 로그인 / 게스트 분기 + select.html 진입
 */

window.addEventListener('load', () => {
  const token = localStorage.getItem('token');
  const displayName = localStorage.getItem('nickname') || localStorage.getItem('username');
  if (token && displayName) {
    document.getElementById('loggedInArea').style.display = 'block';
    document.getElementById('loggedInName').textContent = displayName;
    document.getElementById('cardWrapper').style.display = 'none';
  }
});

function goGuest() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('nickname');
  window.location.href = 'select.html';
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('nickname');
  location.reload();
}

function openSongSelect() {
  window.location.href = 'select.html';
}

function closeModal() {
  // 인덱스 페이지의 레거시 모달이 남아있을 경우 닫기용
  const m = document.getElementById('modalOverlay');
  if (m) m.style.display = 'none';
}


// ─────────────────────────────────────────
// 닉네임 변경 팝업
// ─────────────────────────────────────────
const NICKNAME_RULE = /^[가-힣a-zA-Z0-9]{2,10}$/;

function openNicknameModal() {
  document.getElementById('nickInput').value = localStorage.getItem('nickname') || '';
  document.getElementById('nickError').textContent = '';
  document.getElementById('nickOverlay').style.display = 'flex';
  document.getElementById('nickInput').focus();
}

function closeNicknameModal() {
  document.getElementById('nickOverlay').style.display = 'none';
}

async function saveNickname() {
  const nickname = document.getElementById('nickInput').value.trim();
  const errorEl = document.getElementById('nickError');
  const saveBtn = document.getElementById('nickSaveBtn');

  if (!NICKNAME_RULE.test(nickname)) {
    errorEl.textContent = '닉네임은 한글, 영문, 숫자로 2~10자여야 합니다.';
    return;
  }

  saveBtn.disabled = true;
  errorEl.textContent = '';
  try {
    const res = await fetch('/api/auth/nickname', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: JSON.stringify({ nickname })
    });
    const data = await res.json();

    if (res.status === 401) {
      logoutExpired();
      return;
    }
    if (!res.ok) {
      errorEl.textContent = data.error || '닉네임 변경에 실패했습니다.';
      return;
    }

    localStorage.setItem('nickname', data.nickname);
    document.getElementById('loggedInName').textContent = data.nickname;
    closeNicknameModal();
  } catch (e) {
    errorEl.textContent = '서버 오류가 발생했습니다.';
  } finally {
    saveBtn.disabled = false;
  }
}

// 토큰이 만료되었을 때: 저장된 로그인 정보를 지우고 로그인 화면으로
function logoutExpired() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('nickname');
  alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
  window.location.href = 'login.html';
}

document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('nickOverlay');
  if (!overlay || overlay.style.display === 'none') return;
  if (e.key === 'Enter') saveNickname();
  if (e.key === 'Escape') closeNicknameModal();
});
