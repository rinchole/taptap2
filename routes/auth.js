const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
require('dotenv').config();

// ─────────────────────────────────────────
// 설정
// ─────────────────────────────────────────
const NICKNAME_RULE = /^[가-힣a-zA-Z0-9]{2,10}$/;
const NICKNAME_RULE_MSG = '닉네임은 한글, 영문, 숫자로 2~10자여야 합니다.';

const PROVIDERS = {
  kakao: {
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: 'profile_nickname',
    clientId: () => process.env.KAKAO_CLIENT_ID,
    clientSecret: () => process.env.KAKAO_CLIENT_SECRET,
    redirectUri: () => process.env.KAKAO_REDIRECT_URI,
    parse: (u) => {
      const profile = (u.kakao_account && u.kakao_account.profile) || {};
      return {
        providerId: String(u.id),
        name: profile.nickname || (u.properties && u.properties.nickname) || '',
        image: profile.profile_image_url || (u.properties && u.properties.profile_image) || ''
      };
    }
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: () => process.env.GOOGLE_REDIRECT_URI,
    parse: (u) => ({
      providerId: String(u.sub),
      name: u.name || '',
      image: u.picture || ''
    })
  }
};

// ─────────────────────────────────────────
// 공통 함수
// ─────────────────────────────────────────
function frontendUrl() {
  return (process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

// 로그인 실패 시 로그인 화면으로 돌려보낸다
function redirectWithError(res, msg) {
  res.redirect(frontendUrl() + '/login.html?error=' + encodeURIComponent(msg));
}

// 로그인용 JWT (7일). scores.js 는 id 로 사용자를 구분한다
function signLoginToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// 닉네임 검사 — 통과하면 정리된 닉네임, 실패하면 null
function cleanNickname(raw) {
  const nickname = typeof raw === 'string' ? raw.trim() : '';
  return NICKNAME_RULE.test(nickname) ? nickname : null;
}

// 소셜 이름을 닉네임 규칙에 맞게 다듬은 추천값 (규칙에 못 맞추면 빈 문자열)
function suggestNickname(name) {
  const s = String(name || '').replace(/[^가-힣a-zA-Z0-9]/g, '').slice(0, 10);
  return s.length >= 2 ? s : '';
}

// :provider 가 kakao / google 이 아니면 404 (Express 5 는 경로에 정규식을 못 써서 직접 검사)
function checkProvider(req, res, next) {
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, req.params.provider)) {
    return res.status(404).json({ error: '지원하지 않는 로그인 방식입니다.' });
  }
  next();
}

// Bearer 토큰으로 본인 확인 (로그인용 토큰만 통과)
function authMiddleware(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id) throw new Error('로그인 토큰이 아님');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: '토큰이 만료되었습니다. 다시 로그인하세요.' });
  }
}

// ─────────────────────────────────────────
// 소셜 로그인 시작
// ─────────────────────────────────────────

/**
 * @openapi
 * /api/auth/{provider}:
 *   get:
 *     summary: 소셜 로그인 시작 (카카오 또는 구글 로그인 화면으로 이동)
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [kakao, google] }
 *     responses:
 *       302: { description: 소셜 로그인 화면으로 리다이렉트 (CSRF 방지용 state 포함) }
 */
router.get('/:provider', checkProvider, (req, res) => {
  const provider = req.params.provider;
  const p = PROVIDERS[provider];

  // state: 콜백에서 우리가 보낸 요청인지 확인하는 10분짜리 서명값
  const state = jwt.sign({ type: 'state', provider }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: p.redirectUri(),
    response_type: 'code',
    scope: p.scope,
    state
  });
  res.redirect(p.authUrl + '?' + params.toString());
});

// ─────────────────────────────────────────
// 소셜 로그인 콜백
// ─────────────────────────────────────────

/**
 * @openapi
 * /api/auth/{provider}/callback:
 *   get:
 *     summary: 소셜 로그인 콜백
 *     description: |
 *       인가 코드를 토큰으로 교환하고 사용자 정보를 조회한다.
 *       - 이미 가입한 사용자: JWT 를 URL 해시(#)에 담아 auth-callback.html 로 이동
 *       - 처음 온 사용자: 10분짜리 가입용 토큰을 URL 해시에 담아 nickname.html 로 이동
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [kakao, google] }
 *       - { in: query, name: code,  schema: { type: string } }
 *       - { in: query, name: state, schema: { type: string } }
 *     responses:
 *       302: { description: 프론트 페이지로 리다이렉트 }
 */
router.get('/:provider/callback', checkProvider, async (req, res) => {
  const provider = req.params.provider;
  const p = PROVIDERS[provider];
  const { code, state, error } = req.query;

  if (error || !code) return redirectWithError(res, '소셜 로그인이 취소되었습니다.');

  // state 검증 (CSRF 방지)
  try {
    const decoded = jwt.verify(String(state), process.env.JWT_SECRET);
    if (decoded.type !== 'state' || decoded.provider !== provider) throw new Error('state 불일치');
  } catch {
    return redirectWithError(res, '잘못된 로그인 요청입니다. 다시 시도해주세요.');
  }

  try {
    // 1) 인가 코드 → 액세스 토큰
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: p.clientId(),
      redirect_uri: p.redirectUri(),
      code: String(code)
    });
    if (p.clientSecret()) body.set('client_secret', p.clientSecret());

    const tokenRes = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[' + provider + '] 토큰 발급 실패:', tokenData.error || tokenRes.status);
      return redirectWithError(res, '토큰 발급에 실패했습니다.');
    }

    // 2) 액세스 토큰 → 사용자 정보
    const userRes = await fetch(p.userUrl, {
      headers: { Authorization: 'Bearer ' + tokenData.access_token }
    });
    const userData = await userRes.json();
    if (!userRes.ok) {
      console.error('[' + provider + '] 사용자 정보 조회 실패:', userRes.status);
      return redirectWithError(res, '사용자 정보를 가져오지 못했습니다.');
    }
    const info = p.parse(userData);

    // 3) 이미 가입했는지 확인
    const [rows] = await db.query(
      'SELECT id, username, nickname FROM users WHERE provider = ? AND provider_id = ?',
      [provider, info.providerId]
    );

    // 토큰은 URL 해시(#)로 넘긴다 → 서버 로그와 Referer 에 남지 않는다
    if (rows.length > 0) {
      const user = rows[0];
      return res.redirect(
        frontendUrl() + '/auth-callback.html#token=' + encodeURIComponent(signLoginToken(user)) +
        '&username=' + encodeURIComponent(user.username) +
        '&nickname=' + encodeURIComponent(user.nickname)
      );
    }

    // 4) 처음 온 사용자 → 닉네임 입력 화면으로 (아직 계정은 만들지 않는다)
    const signupToken = jwt.sign(
      { type: 'signup', provider, providerId: info.providerId, image: info.image },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.redirect(
      frontendUrl() + '/nickname.html#signup=' + encodeURIComponent(signupToken) +
      '&suggest=' + encodeURIComponent(suggestNickname(info.name))
    );
  } catch (err) {
    console.error('[GET /api/auth/' + provider + '/callback] error:', err.message);
    redirectWithError(res, '서버 오류가 발생했습니다.');
  }
});

// ─────────────────────────────────────────
// 가입 완료 (닉네임 설정)
// ─────────────────────────────────────────

/**
 * @openapi
 * /api/auth/signup:
 *   post:
 *     summary: 소셜 가입 완료 (닉네임 설정 후 계정 생성, JWT 발급)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signupToken, nickname]
 *             properties:
 *               signupToken: { type: string, description: "콜백에서 받은 10분짜리 가입용 토큰" }
 *               nickname:    { type: string, example: "player1", description: "한글/영문/숫자 2~10자" }
 *     responses:
 *       200:
 *         description: 가입 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:    { type: string, description: "JWT Bearer 토큰 (7일)" }
 *                 username: { type: string }
 *                 nickname: { type: string }
 *       400: { description: 닉네임 규칙 위반 또는 이미 사용 중인 닉네임 }
 *       401: { description: 가입용 토큰 만료 또는 잘못됨 }
 */
router.post('/signup', async (req, res) => {
  const { signupToken, nickname: rawNickname } = req.body;

  let signup;
  try {
    signup = jwt.verify(String(signupToken), process.env.JWT_SECRET);
    if (signup.type !== 'signup') throw new Error('가입용 토큰이 아님');
  } catch {
    return res.status(401).json({ error: '가입 시간이 만료되었습니다. 소셜 로그인을 다시 해주세요.' });
  }

  const nickname = cleanNickname(rawNickname);
  if (!nickname) return res.status(400).json({ error: NICKNAME_RULE_MSG });

  const username = signup.provider + '_' + signup.providerId;

  try {
    const [result] = await db.query(
      'INSERT INTO users (provider, provider_id, username, nickname, profile_image) VALUES (?, ?, ?, ?, ?)',
      [signup.provider, signup.providerId, username, nickname, signup.image || '']
    );
    const user = { id: result.insertId, username };
    res.json({ token: signLoginToken(user), username, nickname });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // 닉네임이 겹친 경우
      if (String(err.sqlMessage).includes('nickname')) {
        return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
      }
      // 같은 소셜 계정이 이미 가입된 경우 (가입 화면을 두 번 제출한 경우 등)
      return res.status(400).json({ error: '이미 가입된 계정입니다. 다시 로그인해주세요.' });
    }
    console.error('[POST /api/auth/signup] error:', err.message);
    res.status(500).json({ error: '가입 처리 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────
// 닉네임 변경
// ─────────────────────────────────────────

/**
 * @openapi
 * /api/auth/nickname:
 *   patch:
 *     summary: 닉네임 변경
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nickname]
 *             properties:
 *               nickname: { type: string, example: "newname", description: "한글/영문/숫자 2~10자" }
 *     responses:
 *       200:
 *         description: 변경 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 nickname: { type: string }
 *       400: { description: 닉네임 규칙 위반 또는 이미 사용 중인 닉네임 }
 *       401: { description: 인증 실패 }
 */
router.patch('/nickname', authMiddleware, async (req, res) => {
  const nickname = cleanNickname(req.body.nickname);
  if (!nickname) return res.status(400).json({ error: NICKNAME_RULE_MSG });

  try {
    await db.query('UPDATE users SET nickname = ? WHERE id = ?', [nickname, req.user.id]);
    res.json({ nickname });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
    }
    console.error('[PATCH /api/auth/nickname] error:', err.message);
    res.status(500).json({ error: '닉네임 변경 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
