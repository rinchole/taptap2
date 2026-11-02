/**
 * 자동 채보 모듈 (Auto-Chart)
 * ─────────────────────────────────────────
 *  입력 : ArrayBuffer (오디오 파일) + 난이도
 *  출력 : [{ time: 초, lane: 0~3 }, ...]
 *
 *  알고리즘:
 *    1) 1024 샘플 프레임 단위로 에너지 계산
 *    2) Spectral Flux (양의 변화량) 로 onset 후보 추출
 *    3) 동적 임계값(이동 평균 × 난이도 계수)으로 필터
 *    4) 최소 간격 보장 후 노트 시간 확정
 *    5) Zero-Crossing Rate 로 레인 배정 (저주파→0, 고주파→3)
 *
 *  공유 모듈: select.js 와 (필요 시) play.js 가 같이 사용
 */
(function (global) {
  'use strict';

  const DIFF_PARAMS = {
    easy:   { thresholdMult: 2.0,  minGap: 0.30 },
    normal: { thresholdMult: 1.5,  minGap: 0.18 },
    hard:   { thresholdMult: 1.15, minGap: 0.10 }
  };

  /**
   * 전체 파이프라인 — ArrayBuffer 받아서 비트맵 생성
   * @param {ArrayBuffer} arrayBuffer  - 원본 음원 데이터 (디코딩 전)
   * @param {string}      difficulty   - 'easy' | 'normal' | 'hard'
   * @returns {Promise<{ beatmap: Array<{time:number,lane:number}>, duration:number }>}
   */
  async function generate(arrayBuffer, difficulty) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // decodeAudioData 는 buffer 를 detach 시키므로 슬라이스 복사본 사용
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    const onsets = detectOnsets(audioBuffer, difficulty);
    const beatmap = assignLanes(onsets, audioBuffer);

    return {
      beatmap,
      duration: audioBuffer.duration
    };
  }

  /**
   * Spectral Flux 기반 onset detection
   */
  function detectOnsets(audioBuffer, difficulty) {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    const len = ch0.length;
    const sampleRate = audioBuffer.sampleRate;

    const frameSize = 1024;
    const numFrames = Math.floor(len / frameSize);

    // 프레임별 에너지 (양 채널 평균)
    const energies = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let sum = 0;
      const start = f * frameSize;
      for (let j = 0; j < frameSize; j++) {
        const v = (ch0[start + j] + ch1[start + j]) * 0.5;
        sum += v * v;
      }
      energies[f] = sum / frameSize;
    }

    // 스펙트럴 플럭스 (양의 변화량만)
    const flux = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      flux[i] = Math.max(0, energies[i] - energies[i - 1]);
    }

    // 동적 임계값 (이동 평균 × 난이도 계수)
    const params = DIFF_PARAMS[difficulty] || DIFF_PARAMS.normal;
    const win = 20;
    const dynThresh = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - win); j < Math.min(numFrames, i + win); j++) {
        s += flux[j]; c++;
      }
      dynThresh[i] = (s / c) * params.thresholdMult;
    }

    // 로컬 피크 + 임계값 통과
    const onsets = [];
    for (let i = 2; i < numFrames - 2; i++) {
      if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > dynThresh[i]) {
        onsets.push((i * frameSize) / sampleRate);
      }
    }

    // 최소 간격 필터
    const filtered = [];
    let last = -Infinity;
    for (const t of onsets) {
      if (t - last >= params.minGap) {
        filtered.push(t);
        last = t;
      }
    }
    return filtered;
  }

  /**
   * Zero-Crossing Rate 기반 레인 배정
   *   - 낮은 ZCR (저주파)  → 레인 0 (Q)
   *   - 높은 ZCR (고주파)  → 레인 3 (P)
   *   - 같은 레인 연속 방지
   */
  function assignLanes(onsets, audioBuffer) {
    let lastLane = -1;
    const ch = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;
    const windowSize = 2048;

    return onsets.map(t => {
      const center = Math.floor(t * sr);
      const start = Math.max(0, center - windowSize / 2);
      const end = Math.min(ch.length, start + windowSize);
      let zcr = 0;
      for (let i = start + 1; i < end; i++) {
        if ((ch[i - 1] >= 0 && ch[i] < 0) || (ch[i - 1] < 0 && ch[i] >= 0)) zcr++;
      }
      const ratio = zcr / (end - start);
      let lane;
      if (ratio < 0.04)      lane = 0;
      else if (ratio < 0.08) lane = 1;
      else if (ratio < 0.14) lane = 2;
      else                   lane = 3;
      if (lane === lastLane) lane = (lane + 1) % 4;
      lastLane = lane;
      return { time: t, lane };
    });
  }

  // 외부 노출
  global.AutoChart = {
    generate,
    detectOnsets,
    assignLanes
  };
})(window);
