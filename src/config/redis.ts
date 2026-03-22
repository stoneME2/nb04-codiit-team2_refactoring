import { Redis } from 'ioredis';
import { env } from '@/config/constants.js';
import { logger } from '@/config/logger.js';

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3, //redis 최대 몇 번 호출할 거냐
  lazyConnect: false, //서버 시작 시 바로 redis 켜지도록
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis connection error');
});

export default redis;
