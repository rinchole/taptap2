const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const swaggerSpec = require('./swagger');
const db = require('./db');

const app = express();

// CORS
// 프론트(public/)와 API가 같은 서버에서 나가므로 기본은 같은 출처만 허용한다.
// 다른 주소에서 API를 불러야 할 때만 .env 의 CORS_ORIGIN 에 그 주소를 적는다.
// (여러 개면 쉼표로 구분: https://a.com,https://b.com)
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length > 0 ? corsOrigins : false }));

app.use(express.json());
app.use(express.static('public'));

// REST API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/scores', require('./routes/scores'));

// OpenAPI / Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'TAPTAP API Docs',
  customCss: '.topbar { display: none; }'
}));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

// ─────────────────────────────────────────
// DB 자동 마이그레이션 — 서버 시작 시 1회 (조용히 실행)
// ─────────────────────────────────────────
async function initDb() {
  // 예전 구조(아이디/비밀번호 가입)의 users 테이블이면 한 번만 지우고 새로 만든다
  // (소셜 로그인 전환 전의 테스트 데이터만 있다는 전제)
  try {
    const [oldCols] = await db.query("SHOW COLUMNS FROM users LIKE 'password'");
    if (oldCols.length > 0) {
      console.log('[DB] 예전 users 구조 발견 → scores, users 를 지우고 새로 만듭니다.');
      await db.query('DROP TABLE IF EXISTS scores');
      await db.query('DROP TABLE users');
    }
  } catch (e) {
    // users 테이블이 아직 없으면 무시
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      console.error('[DB] 예전 구조 확인 실패:', e.message);
    }
  }

  // users 테이블 (소셜 로그인 전용)
  try {
    await db.query(
      'CREATE TABLE IF NOT EXISTS users (' +
      '  id INT AUTO_INCREMENT PRIMARY KEY,' +
      '  provider VARCHAR(20) NOT NULL,' +
      '  provider_id VARCHAR(100) NOT NULL,' +
      '  username VARCHAR(60) NOT NULL UNIQUE,' +
      '  nickname VARCHAR(30) NOT NULL UNIQUE,' +
      '  profile_image VARCHAR(500) DEFAULT \'\',' +
      '  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
      '  UNIQUE KEY uniq_social (provider, provider_id)' +
      ') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
  } catch (e) {
    console.error('[DB] users 테이블 생성 실패:', e.message);
  }

  // scores 테이블
  try {
    await db.query(
      'CREATE TABLE IF NOT EXISTS scores (' +
      '  id INT AUTO_INCREMENT PRIMARY KEY,' +
      '  user_id INT NOT NULL,' +
      '  song VARCHAR(100) NOT NULL,' +
      '  diff VARCHAR(10) NOT NULL,' +
      '  score INT NOT NULL DEFAULT 0,' +
      '  combo INT NOT NULL DEFAULT 0,' +
      '  accuracy INT NOT NULL DEFAULT 0,' +
      '  grade CHAR(1) NOT NULL DEFAULT \'D\',' +
      '  track_title VARCHAR(200) DEFAULT \'\',' +
      '  track_artist VARCHAR(200) DEFAULT \'\',' +
      '  track_artwork VARCHAR(500) DEFAULT \'\',' +
      '  played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
      '  UNIQUE KEY uniq_play (user_id, song, diff),' +
      '  INDEX idx_user (user_id),' +
      '  INDEX idx_song_diff (song, diff)' +
      ') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
  } catch (e) {
    console.error('[DB] scores 테이블 생성 실패:', e.message);
  }

  // 새 컬럼 추가 (이미 있으면 조용히 무시)
  const addCols = [
    "ALTER TABLE scores ADD COLUMN track_title VARCHAR(200) DEFAULT ''",
    "ALTER TABLE scores ADD COLUMN track_artist VARCHAR(200) DEFAULT ''",
    "ALTER TABLE scores ADD COLUMN track_artwork VARCHAR(500) DEFAULT ''"
  ];
  for (const sql of addCols) {
    try { await db.query(sql); }
    catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        console.error('[DB] 컬럼 추가 실패:', e.message);
      }
    }
  }

  // song 컬럼 길이 확장
  try { await db.query("ALTER TABLE scores MODIFY COLUMN song VARCHAR(100) NOT NULL"); }
  catch (e) { /* 무시 */ }

  // UNIQUE KEY 추가
  try { await db.query("ALTER TABLE scores ADD UNIQUE KEY uniq_play (user_id, song, diff)"); }
  catch (e) {
    if (e.code !== 'ER_DUP_KEYNAME' && e.code !== 'ER_DUP_ENTRY') {
      console.error('[DB] UNIQUE KEY 추가 실패:', e.message);
    }
  }
}

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log('🎵 서버 실행중: ' + BASE_URL + ' (포트 ' + PORT + ')');
      console.log('📖 API 문서:    ' + BASE_URL + '/api-docs');
      console.log('📄 OAS JSON:    ' + BASE_URL + '/api-docs.json');
    });
  })
  .catch(err => {
    console.error('[FATAL] DB 초기화 실패:', err.message);
    console.error('DB가 실행 중인지, .env 의 DB 설정이 맞는지 확인하세요.');
    process.exit(1);
  });