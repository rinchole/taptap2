// 소셜 로그인 직후 처음 온 사용자의 닉네임 설정 → 가입 완료
const NICKNAME_RULE = /^[가-힣a-zA-Z0-9]{2,10}$/;
const NICKNAME_RULE_MSG = '닉네임은 한글, 영문, 숫자로 2~10자여야 합니다.';

const input = document.getElementById('nickname-input');
const submitBtn = document.getElementById('nickname-submit');
const errorEl = document.getElementById('nickname-error');

// 백엔드가 주소의 # 뒤에 넣어준 가입용 토큰과 추천 닉네임을 읽고, 주소창에서는 지운다
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const signupToken = hash.get('signup');
input.value = hash.get('suggest') || '';
history.replaceState(null, '', 'nickname.html');

if (!signupToken) {
  errorEl.textContent = '잘못된 접근입니다. 소셜 로그인을 다시 해주세요.';
  submitBtn.disabled = true;
}

async function submit() {
  const nickname = input.value.trim();
  if (!NICKNAME_RULE.test(nickname)) {
    errorEl.textContent = NICKNAME_RULE_MSG;
    return;
  }

  submitBtn.disabled = true;
  errorEl.textContent = '';
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signupToken, nickname })
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || '가입에 실패했습니다.';
      // 가입 시간이 지났으면 처음부터 다시 해야 한다
      if (res.status === 401) return;
      submitBtn.disabled = false;
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    localStorage.setItem('nickname', data.nickname);
    window.location.href = 'select.html';
  } catch (e) {
    errorEl.textContent = '서버 오류가 발생했습니다.';
    submitBtn.disabled = false;
  }
}

submitBtn.addEventListener('click', submit);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  window.location.href = 'index.html';
});
