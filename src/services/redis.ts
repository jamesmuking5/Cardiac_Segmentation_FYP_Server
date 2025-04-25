import { createClient } from 'redis';
import path from 'path';
import dotenv from 'dotenv';
import logger from './logger'; // Assuming you have a logger like in database.ts

// Load environment variables
try {
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
} catch (error: unknown) {
  logger.error(`Redis Client: Failed to load environment variables. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  throw new Error('Failed to load environment variables for Redis.');
}

// Log the loaded environment variables for debugging
logger.info(`Redis Client: REDIS_HOST=${process.env.REDIS_HOST}, REDIS_PORT=${process.env.REDIS_PORT}`);

// Create Redis client with retry strategy
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  password: process.env.REDIS_PASSWORD || undefined,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        logger.error('Redis Client: Exceeded maximum retry attempts.');
        return new Error('Exceeded maximum retry attempts to connect to Redis.');
      }
      logger.warn(`Redis Client: Retry attempt ${retries}.`);
      return Math.min(retries * 100, 3000); // Retry with exponential backoff (max 3 seconds)
    },
  },
});

// Handle Redis client errors
redisClient.on('error', (err) => {
  logger.error('Redis Client Error', err);
});

// Connect to Redis
const connectRedis = async (): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info('Redis Client: Successfully connected to Redis.');
    }
  } catch (error: unknown) {
    logger.error(`Redis Client: Failed to connect to Redis. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw new Error('Failed to connect to Redis. Please check your Redis configuration.');
  }
};

// Check Redis health
const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const reply = await redisClient.ping(); // Simple Redis ping check
    return reply === 'PONG';
  } catch (error) {
    logger.error('Redis Client: Health check failed.', error);
    return false;
  }
};

export { redisClient, connectRedis, checkRedisHealth };