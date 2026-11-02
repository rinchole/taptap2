-- TAPTAP DB 스키마
-- 사용법: MySQL 에 접속해서 한 줄씩 실행하거나,
--   mysql -u root -p rhythm_game < db-schema.sql

CREATE DATABASE IF NOT EXISTS rhythm_game
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE rhythm_game;

-- 사용자 테이블 (카카오 / 구글 소셜 로그인 전용, 비밀번호 없음)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(20)  NOT NULL,          -- 'kakao' / 'google'
  provider_id   VARCHAR(100) NOT NULL,          -- 소셜 서비스가 부여한 사용자 번호
  username      VARCHAR(60)  NOT NULL UNIQUE,   -- 내부용 고유값 (예: kakao_12345)
  nickname      VARCHAR(30)  NOT NULL UNIQUE,   -- 화면/랭킹에 보이는 이름
  profile_image VARCHAR(500) DEFAULT '',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_social (provider, provider_id)
);

-- 점수 테이블 (iTunes 곡 메타 정보 포함)
CREATE TABLE IF NOT EXISTS scores (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  song          VARCHAR(100) NOT NULL,         -- 'itunes:1234567890'
  diff          VARCHAR(10)  NOT NULL,         -- easy / normal / hard
  score         INT          NOT NULL DEFAULT 0,
  combo         INT          NOT NULL DEFAULT 0,
  accuracy      INT          NOT NULL DEFAULT 0,
  grade         CHAR(1)      NOT NULL DEFAULT 'D',
  track_title   VARCHAR(200) DEFAULT '',
  track_artist  VARCHAR(200) DEFAULT '',
  track_artwork VARCHAR(500) DEFAULT '',
  played_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_play (user_id, song, diff),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 기존 테이블이 있는 경우 컬럼만 추가 (이미 있으면 에러 무시 가능)
ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS track_title   VARCHAR(200) DEFAULT '',
  ADD COLUMN IF NOT EXISTS track_artist  VARCHAR(200) DEFAULT '',
  ADD COLUMN IF NOT EXISTS track_artwork VARCHAR(500) DEFAULT '';

-- UNIQUE 제약이 없을 경우 추가
-- (이미 있으면 'Duplicate key name' 에러가 나는데 무시)
-- ALTER TABLE scores ADD UNIQUE KEY uniq_play (user_id, song, diff);
