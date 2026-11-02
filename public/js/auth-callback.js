// 이미 가입한 사용자가 소셜 로그인을 마치고 돌아오는 곳
// 백엔드가 주소의 # 뒤에 token, username, nickname 을 넣어준다
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const token = hash.get('token');
const username = hash.get('username');
const nickname = hash.get('nickname');

// 토큰이 주소창에 남지 않게 바로 지운다
history.replaceState(null, '', 'auth-callback.html');

if (token && username && nickname) {
  localStorage.setItem('token', token);
  localStorage.setItem('username', username);
  localStorage.setItem('nickname', nickname);
  window.location.replace('select.html');
} else {
  document.getElementById('callback-error').textContent =
    '로그인 정보를 받지 못했습니다. 로그인 화면으로 이동합니다.';
  setTimeout(() => { window.location.replace('login.html'); }, 2000);
}
