// 소셜 로그인 버튼 → 백엔드가 카카오/구글 로그인 화면으로 보내준다
document.getElementById('kakao-btn').addEventListener('click', () => {
  window.location.href = '/api/auth/kakao';
});

document.getElementById('google-btn').addEventListener('click', () => {
  window.location.href = '/api/auth/google';
});

// 로그인 실패 시 백엔드가 ?error=메시지 로 돌려보낸다
const errorMsg = new URLSearchParams(window.location.search).get('error');
if (errorMsg) {
  document.getElementById('login-error').textContent = errorMsg;
}

document.getElementById('guest-btn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('nickname');
  window.location.href = 'index.html';
});
