// File: src/index.ts
// Description: Main application entry point. Handles server startup and database connection.

import dotenv from 'dotenv';
import path from 'path';

import logger from './services/logger'; // Import Winston Logger
import { connectRedis, checkRedisHealth } from './services/redis'; // Import Redis connection and health check

// Service Location for logging within this file
const serviceLocation = 'Main';

// Load environment variables
try {
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
} catch (error: unknown) {
  logger.error(`${serviceLocation}: Failed to load environment variables. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  // process.exit(1); // Optionally exit if critical error occurs
}

// Import necessary modules AFTER dotenv
import { app } from './services/express_app'; // Import the configured Express app
import LogError from './utils/error_logger'; // Import error logging utility
import { connectToDatabase } from './services/database'; // Import DB connection function

// Get PORT from environment variables (now guaranteed to be loaded)
const PORT = process.env.PORT || 3000;

// Connect to MongoDB and start server
(async (): Promise<void> => {
  try {
    // // Connect to Redis
    // await connectRedis();
    // logger.info(`${serviceLocation}: Successfully connected to Redis.`);

    // // Optionally check Redis health
    // const isRedisHealthy = await checkRedisHealth();
    // if (!isRedisHealthy) {
    //   throw new Error('Redis health check failed.');
    // }

    await connectToDatabase();
    // Start the server only a4fter successful DB connection
    app.listen(PORT, () => {
      logger.info(`Server running at http://localhost:${PORT}`);
    });
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, 'Error during initial database connection or server startup.');
    // process.exit(1); // Optionally exit on critical error
  }
})().catch((error: unknown) => {
  // This catch handles potential errors *outside* the async function's try-catch
  // (less likely in this specific setup, but satisfies the rule)
  LogError(error as Error, serviceLocation, 'Unhandled error occurred in top-level async execution.');
  process.exit(1); // Exit if the IIAFE itself fails critically
});

// Note: The `export const app = express();` line is removed from here.
// All middleware and route setup is now handled in app.ts.