const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
require('dotenv').config();

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

/**
 * @openapi
 * /api/scores:
 *   post:
 *     summary: 게임 점수 저장 (베스트만 유지)
 *     tags: [Scores]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trackId, diff, score, combo, accuracy, grade]
 *             properties:
 *               trackId:      { type: string }
 *               diff:         { type: string, enum: [easy, normal, hard] }
 *               score:        { type: integer }
 *               combo:        { type: integer }
 *               accuracy:     { type: integer }
 *               grade:        { type: string, enum: [S, A, B, C, D] }
 *               trackTitle:   { type: string }
 *               trackArtist:  { type: string }
 *               trackArtwork: { type: string }
 *     responses:
 *       200: { description: 저장 성공 }
 *       401: { description: 인증 실패 }
 */
router.post('/', authMiddleware, async (req, res) => {
  const {
    trackId, diff,
    score = 0, combo = 0, accuracy = 0, grade = 'D',
    trackTitle = '', trackArtist = '', trackArtwork = ''
  } = req.body;
  const user_id = req.user.id;

  if (!trackId || !diff) {
    return res.status(400).json({ error: 'trackId, diff 필수' });
  }
  const songKey = 'itunes:' + trackId;

  try {
    await db.query(
      'INSERT INTO scores (user_id, song, diff, score, combo, accuracy, grade, track_title, track_artist, track_artwork) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE ' +
      '  combo        = IF(VALUES(score) > score, VALUES(combo), combo), ' +
      '  accuracy     = IF(VALUES(score) > score, VALUES(accuracy), accuracy), ' +
      '  grade        = IF(VALUES(score) > score, VALUES(grade), grade), ' +
      '  track_title  = IF(VALUES(track_title) <> \'\', VALUES(track_title), track_title), ' +
      '  track_artist = IF(VALUES(track_artist) <> \'\', VALUES(track_artist), track_artist), ' +
      '  track_artwork= IF(VALUES(track_artwork) <> \'\', VALUES(track_artwork), track_artwork), ' +
      '  played_at    = IF(VALUES(score) > score, NOW(), played_at), ' +
      // MySQL 은 대입을 위에서부터 처리하므로 score 는 반드시 마지막에 갱신한다
      // (먼저 바꾸면 위 항목들의 "새 점수 > 현재 점수" 비교가 항상 거짓이 된다)
      '  score        = IF(VALUES(score) > score, VALUES(score), score)',
      [user_id, songKey, diff,
       Number(score) || 0, Number(combo) || 0, Number(accuracy) || 0, grade,
       String(trackTitle || ''), String(trackArtist || ''), String(trackArtwork || '')]
    );

    // 플레이 이력 한 줄 추가 (실패해도 베스트 점수 저장은 그대로 성공 처리)
    try {
      await db.query(
        'INSERT INTO play_history (user_id, song, diff, score, combo, accuracy, grade, track_title, track_artist, track_artwork) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user_id, songKey, diff,
         Number(score) || 0, Number(combo) || 0, Number(accuracy) || 0, grade,
         String(trackTitle || ''), String(trackArtist || ''), String(trackArtwork || '')]
      );
    } catch (histErr) {
      console.error('[POST /api/scores] 이력 저장 실패:', histErr.code, histErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/scores] DB error:', err.code, err.message);
    res.status(500).json({
      error: '점수 저장 실패',
      detail: err.message,
      code: err.code
    });
  }
});

/**
 * @openapi
 * /api/scores/ranking:
 *   get:
 *     summary: 특정 곡·난이도의 TOP 20 랭킹 조회
 *     tags: [Scores]
 *     parameters:
 *       - { in: query, name: trackId, required: true, schema: { type: string } }
 *       - { in: query, name: diff,    required: true, schema: { type: string, enum: [easy, normal, hard] } }
 *     responses:
 *       200: { description: TOP 20 (점수 내림차순) }
 */
router.get('/ranking', async (req, res) => {
  const { trackId, diff } = req.query;
  if (!trackId || !diff) {
    return res.status(400).json({ error: 'trackId, diff 필수' });
  }
  const songKey = 'itunes:' + trackId;
  try {
    const [rows] = await db.query(
      'SELECT u.nickname AS username, s.score, s.accuracy, s.grade, ' +
      '       s.track_title AS trackTitle, s.track_artist AS trackArtist, s.track_artwork AS trackArtwork ' +
      'FROM scores s JOIN users u ON s.user_id = u.id ' +
      'WHERE s.song = ? AND s.diff = ? ' +
      'ORDER BY s.score DESC LIMIT 20',
      [songKey, diff]
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/scores/ranking] DB error:', err.code, err.message);
    res.status(500).json({ error: '랭킹 조회 실패', detail: err.message });
  }
});

/**
 * @openapi
 * /api/scores/tracks:
 *   get:
 *     summary: 플레이 이력이 있는 곡 목록
 *     tags: [Scores]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: 곡별 플레이 횟수 내림차순 }
 */
router.get('/tracks', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const [rows] = await db.query(
      'SELECT ' +
      '  SUBSTRING(song, 8) AS trackId, ' +
      '  MAX(track_title) AS trackTitle, ' +
      '  MAX(track_artist) AS trackArtist, ' +
      '  MAX(track_artwork) AS trackArtwork, ' +
      '  COUNT(*) AS playCount, ' +
      '  MAX(score) AS bestScore ' +
      'FROM scores ' +
      "WHERE song LIKE 'itunes:%' " +
      'GROUP BY song ' +
      'ORDER BY playCount DESC, bestScore DESC ' +
      'LIMIT ' + Number(limit)
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/scores/tracks] DB error:', err.code, err.message);
    res.status(500).json({ error: '곡 목록 조회 실패', detail: err.message });
  }
});

/**
 * @openapi
 * /api/scores/me:
 *   get:
 *     summary: 현재 사용자의 점수 기록 조회
 *     tags: [Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: 최근 플레이 순 }
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT SUBSTRING(song, 8) AS trackId, diff, score, accuracy, grade, ' +
      '       track_title AS trackTitle, track_artist AS trackArtist, track_artwork AS trackArtwork, ' +
      '       played_at AS playedAt ' +
      'FROM scores ' +
      "WHERE user_id = ? AND song LIKE 'itunes:%' " +
      'ORDER BY played_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/scores/me] DB error:', err.code, err.message);
    res.status(500).json({ error: '내 기록 조회 실패', detail: err.message });
  }
});

/**
 * @openapi
 * /api/scores/me/summary:
 *   get:
 *     summary: 마이페이지 요약 (프로필, 총 플레이 수, 평균 정확도, 등급·난이도 분포, 곡별 베스트, 최근 이력)
 *     tags: [Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: 요약 데이터 }
 */
router.get('/me/summary', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  try {
    const [[user]] = await db.query(
      'SELECT nickname, profile_image AS profileImage FROM users WHERE id = ?', [uid]
    );
    const [[total]] = await db.query(
      'SELECT COUNT(*) AS totalPlays, ROUND(AVG(accuracy)) AS avgAccuracy FROM play_history WHERE user_id = ?',
      [uid]
    );
    const [grades] = await db.query(
      'SELECT grade, COUNT(*) AS cnt FROM play_history WHERE user_id = ? GROUP BY grade', [uid]
    );
    const [diffs] = await db.query(
      'SELECT diff, COUNT(*) AS cnt FROM play_history WHERE user_id = ? GROUP BY diff', [uid]
    );
    const [bests] = await db.query(
      'SELECT SUBSTRING(song, 8) AS trackId, diff, score, accuracy, grade, ' +
      '       track_title AS trackTitle, track_artist AS trackArtist, track_artwork AS trackArtwork ' +
      'FROM scores WHERE user_id = ? AND song LIKE \'itunes:%\' ORDER BY score DESC LIMIT 30',
      [uid]
    );
    const [recent] = await db.query(
      'SELECT SUBSTRING(song, 8) AS trackId, diff, score, accuracy, grade, ' +
      '       track_title AS trackTitle, track_artist AS trackArtist, track_artwork AS trackArtwork, ' +
      '       played_at AS playedAt ' +
      'FROM play_history WHERE user_id = ? AND song LIKE \'itunes:%\' ORDER BY id DESC LIMIT 20',
      [uid]
    );

    const gradeDist = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    grades.forEach(g => { gradeDist[g.grade] = g.cnt; });
    const diffCounts = { easy: 0, normal: 0, hard: 0 };
    diffs.forEach(d => { diffCounts[d.diff] = d.cnt; });

    res.json({
      nickname: user ? user.nickname : '',
      profileImage: user ? user.profileImage : '',
      totalPlays: total.totalPlays || 0,
      avgAccuracy: total.avgAccuracy === null ? 0 : Number(total.avgAccuracy),
      gradeDist, diffCounts, bests, recent
    });
  } catch (err) {
    console.error('[GET /api/scores/me/summary] DB error:', err.code, err.message);
    res.status(500).json({ error: '마이페이지 조회 실패', detail: err.message });
  }
});

/**
 * @openapi
 * /api/scores/recommendations:
 *   get:
 *     summary: 내 플레이 이력 기반 맞춤 추천 (다시 도전 / 한 단계 위로 / 자주 들은 아티스트)
 *     tags: [Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: retry, levelup, topArtists }
 */
const NEXT_DIFF = { easy: 'normal', normal: 'hard' };

router.get('/recommendations', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  try {
    // 최근 100판에서 곡·난이도별 가장 최근 기록만 남긴다
    const [rows] = await db.query(
      'SELECT SUBSTRING(song, 8) AS trackId, diff, accuracy, ' +
      '       track_title AS trackTitle, track_artist AS trackArtist, track_artwork AS trackArtwork ' +
      'FROM play_history WHERE user_id = ? AND song LIKE \'itunes:%\' ORDER BY id DESC LIMIT 100',
      [uid]
    );
    const seen = new Set();
    const latest = [];
    for (const r of rows) {
      const key = r.trackId + '|' + r.diff;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(r);
    }

    // 다시 도전: 최근 정확도 70% 미만
    const retry = latest.filter(r => r.accuracy < 70).slice(0, 3);

    // 한 단계 위로: 정확도 90% 이상이고 다음 난이도를 아직 안 한 곡
    const levelup = latest
      .filter(r => r.accuracy >= 90 && NEXT_DIFF[r.diff] && !seen.has(r.trackId + '|' + NEXT_DIFF[r.diff]))
      .slice(0, 3)
      .map(r => Object.assign({}, r, { nextDiff: NEXT_DIFF[r.diff] }));

    // 새로운 곡: 많이 플레이한 아티스트 (실제 곡 검색은 프론트가 iTunes 로 한다)
    const [artists] = await db.query(
      'SELECT track_artist AS artist, COUNT(*) AS cnt FROM play_history ' +
      'WHERE user_id = ? AND track_artist <> \'\' GROUP BY track_artist ORDER BY cnt DESC LIMIT 3',
      [uid]
    );

    res.json({ retry, levelup, topArtists: artists.map(a => a.artist) });
  } catch (err) {
    console.error('[GET /api/scores/recommendations] DB error:', err.code, err.message);
    res.status(500).json({ error: '추천 조회 실패', detail: err.message });
  }
});

module.exports = router;
