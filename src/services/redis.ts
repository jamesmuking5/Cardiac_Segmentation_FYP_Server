import { createClient } from 'redis';
import path from 'path';
import dotenv from 'dotenv';
import logger from './logger';
import LogError from '../utils/error_logger';

const serviceLocation = 'Redis';

// Load environment variables
try {
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
} catch (error: unknown) {
  logger.error(`${serviceLocation}: Failed to load environment variables. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  LogError(error as Error, serviceLocation, 'Error loading environment variables.');
}
// Check if using AWS ElastiCache Redis
const redisAWS = process.env.REDIS_AWS === 'true' ? true : false;
let redisUrl = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`; // Use REDIS_URL if provided
if (redisAWS) {
  redisUrl = `rediss://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
}

// Create Redis client with retry strategy
const redisClient = createClient({
  url: redisUrl,
  password: process.env.REDIS_PASSWORD || undefined,
  socket: {
    tls: process.env.REDIS_TLS === 'true',
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        logger.error(`${serviceLocation}: Exceeded maximum retry attempts.`);
        LogError(new Error('Exceeded maximum retry attempts'), serviceLocation, 'Redis connection error.');
      }
      logger.warn(`Redis Client: Retry attempt ${retries}.`);
      return Math.min(retries * 100, 3000); // Retry with exponential backoff (max 3 seconds)
    },
  },
});

// Handle Redis client errors
redisClient.on('error', (err) => {
  logger.error(`${serviceLocation}: Client error. Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  LogError(err as Error, serviceLocation, 'Redis client error.');
});

// Connect to Redis
const connectRedis = async (): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info(`${serviceLocation}: Redis client connected successfully.`);
    }
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Failed to connect to Redis. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    LogError(error as Error, serviceLocation, 'Redis connection error.');
  }
};

// Check Redis health
const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const reply = await redisClient.ping(); // Simple Redis ping check
    return reply === 'PONG';
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Health check failed. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    LogError(error as Error, serviceLocation, 'Redis health check error.');
    return false;
  }
};

export { redisClient, connectRedis, checkRedisHealth };