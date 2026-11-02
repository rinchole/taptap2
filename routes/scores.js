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

module.exports = router;
