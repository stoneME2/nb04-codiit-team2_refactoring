/**
 * 부하 테스트용 쿼리 통계 카운터.
 * Prisma 이벤트 + 서비스 레벨에서 호출하여 쿼리 실행 횟수를 추적한다.
 */
export const queryStats = {
  totalQueries: 0,
  rotations: 0,
  rotationSuccesses: 0,
  rotationFailures: 0,
  _startTime: Date.now(),

  recordQuery() {
    this.totalQueries++;
  },

  recordRotation() {
    this.rotations++;
  },

  recordRotationSuccess() {
    this.rotationSuccesses++;
  },

  recordRotationFailure() {
    this.rotationFailures++;
  },

  getStats() {
    const elapsedSec = (Date.now() - this._startTime) / 1000;
    return {
      totalQueries: this.totalQueries,
      rotations: this.rotations,
      rotationSuccesses: this.rotationSuccesses,
      rotationFailures: this.rotationFailures,
      elapsedSec: Math.round(elapsedSec),
      queriesPerSec: elapsedSec > 0 ? +(this.totalQueries / elapsedSec).toFixed(1) : 0,
    };
  },

  reset() {
    this.totalQueries = 0;
    this.rotations = 0;
    this.rotationSuccesses = 0;
    this.rotationFailures = 0;
    this._startTime = Date.now();
  },
};
