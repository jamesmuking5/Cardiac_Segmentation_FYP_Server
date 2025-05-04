// File: src/index.ts
// Description: Main application entry point. Handles server startup and database connection.

import dotenv from 'dotenv';
import path from 'path';
import logger from './services/logger'; // Import Winston Logger
import { connectRedis, checkRedisHealth } from './services/redis'; // Import Redis connection and health check
import { scheduleGuestCleanup } from './jobs/guestcleanupjob'; // Import guest cleanup job
// Import the http module for graceful shutdown
import http from 'http';

// Service Location for logging within this file
const serviceLocation = 'Main';

// Load environment variables
try {
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
} catch (error: unknown) {
  logger.error(`${serviceLocation}: Failed to load environment variables. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1); // Fatal - exit if critical error occurs
}

// Import necessary modules AFTER dotenv
import { app } from './services/express_app'; // Import the configured Express app
import LogError from './utils/error_logger'; // Import error logging utility
import { connectToDatabase } from './services/database'; // Import DB connection function
import { initAndRefreshAuth, stopTokenRefresh, checkGpuStatusOnInitialization } from './services/gpu_auth_client'; // Import GPU auth client functions

// Get serving host and port from environment variables
const HOST = process.env.HOST || 'localhost'; // Default to localhost if not set
const PORT = parseInt(process.env.PORT || '3000', 10);

// Connect to MongoDB and start server
(async (): Promise<void> => {
  // Declare server variable here so it's accessible in the shutdown handlers
  let server: http.Server | undefined; // Use http.Server type

  try {
    //Initialize GPU Server Authentication
    initAndRefreshAuth();
    logger.info(`${serviceLocation}: GPU Authentication client initialized and refresh scheduled.`);
    
    // Check GPU status on initialization
    await checkGpuStatusOnInitialization();

    // Connect to Redis
    await connectRedis();
    const isRedisHealthy = await checkRedisHealth();
    if (!isRedisHealthy) {
      throw new Error(`${serviceLocation}: Redis health check failed.`);
    }
    logger.info(`${serviceLocation}: Redis connected and health check passed.`);

    // Connect to Database
    await connectToDatabase();
    logger.info(`${serviceLocation}: Database connected.`);

    // Start the Express server listener and assign to the server variable
    server = app.listen(PORT, HOST, () => { // Now PORT is definitely a number
      logger.info(`${serviceLocation}: Server running at http://${HOST}:${PORT}`);
    });

    // Schedule the guest cleanup job (if applicable)
    await scheduleGuestCleanup();
    logger.info(`${serviceLocation}: Guest cleanup job scheduled.`);

    // Graceful Shutdown Logic 
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    signals.forEach((signal) => {
      process.on(signal, () => {
        logger.info(`${serviceLocation}: ${signal} signal received: closing HTTP server and stopping timers...`);
        stopTokenRefresh(); // Stop the JWT refresh interval
        // Add any other cleanup tasks here

        // Check if server exists before closing (it should, if this point is reached)
        if (server) {
          server.close((err: unknown) => {
            if (err) {
              logger.error(`${serviceLocation}: Error closing HTTP server:`, err);
              process.exit(1); // Exit with error if server close fails
            } else {
              logger.info(`${serviceLocation}: HTTP server closed.`);
              // Optionally close Redis connection: redisClient.quit();
              process.exit(0); // Exit gracefully
            }
          });
        } else {
          logger.warn(`${serviceLocation}: Shutdown signal received, but server was not initialized.`);
          process.exit(0); // Exit gracefully even if server wasn't up
        }


        // Force shutdown after a timeout if graceful shutdown fails
        setTimeout(() => {
          logger.warn(`${serviceLocation}: Graceful shutdown timeout exceeded. Forcing exit.`);
          process.exit(1);
        }, 10000); // e.g., 10 seconds timeout
      });
    });


  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, 'FATAL: Error during application startup.');
    process.exit(1); // Exit on critical startup error
  }
})().catch((error: unknown) => {
  logger.error(`${serviceLocation}: UNHANDLED CRITICAL ERROR in top-level async execution:`, error);
  process.exit(1); // Exit if fails critically
});

// Note: The `export const app = express();` line is removed from here.
// All middleware and route setup is now handled in app.ts.