/**
 * OpenAPI Specification (OAS 3.0.3) 설정
 * Swagger UI 에 표시되는 모든 엔드포인트 명세
 * 각 라우트 파일의 @openapi JSDoc 주석에서 자동 추출
 */
const swaggerJSDoc = require('swagger-jsdoc');

// .env 의 BASE_URL 을 쓰고, 없으면 로컬 주소를 쓴다
// (server.js 에서 dotenv 를 먼저 불러오므로 여기서 값을 읽을 수 있다)
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + (process.env.PORT || 3000));

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'TAPTAP API',
      version: '1.0.0',
      description:
        '웹 기반 4-Lane 리듬게임 TAPTAP 의 백엔드 API 명세.\n\n' +
        '- iTunes Search API 와 연동하여 어떤 곡이든 자동 채보로 즉시 플레이 가능\n' +
        '- JWT 기반 stateless 인증\n' +
        '- 곡별 TOP 20 랭킹 + 사용자 맞춤 추천\n'
    },
    servers: [
      { url: BASE_URL, description: process.env.BASE_URL ? '배포 서버' : '로컬 개발 서버' }
    ],
    tags: [
      { name: 'Auth',   description: '카카오·구글 소셜 로그인 / 닉네임 설정 (JWT 발급)' },
      { name: 'Scores', description: '점수 저장 / 랭킹 조회 / 내 기록' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string', example: '오류 메시지' } }
        }
      }
    }
  },
  apis: ['./routes/*.js']
};

module.exports = swaggerJSDoc(options);