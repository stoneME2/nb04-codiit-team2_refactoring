import { PrismaClient } from '@prisma/client';
import { env } from '@/config/constants.js';
import { logger } from '@/config/logger.js';
import { queryStats } from '@/common/utils/queryStats.js';

const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }, 'error', 'warn']
      : ['error'],
});

if (env.NODE_ENV === 'development') {
  prisma.$on('query', () => {
    queryStats.recordQuery();
  });

  // 10초마다 쿼리 통계 로그
  setInterval(() => {
    const stats = queryStats.getStats();
    if (stats.totalQueries > 0) {
      logger.info(
        { event: 'query_stats', ...stats },
        `[Query Stats] total=${stats.totalQueries} | rotations=${stats.rotations} (success=${stats.rotationSuccesses}, fail=${stats.rotationFailures}) | ${stats.elapsedSec}s | ${stats.queriesPerSec} qps`,
      );
    }
  }, 10_000).unref();
}

export default prisma;
