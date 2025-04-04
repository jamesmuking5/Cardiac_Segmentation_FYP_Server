// File: src/services/logger.ts
// Description: Logger service using Winston with daily rotation and colorized output.
const { createLogger, format, transports } = require("winston");
const { combine, timestamp, printf, colorize } = format;
require("winston-daily-rotate-file");

// Define type for log format parameters
interface LogFormatParams {
  level: string;
  message: string;
  timestamp: string;
}

// Define custom log format with colorization
const logFormat = printf(({ level, message, timestamp }: LogFormatParams) => {
  let colorizedTimestamp = timestamp;
  if (level === "info") {
    colorizedTimestamp = `\x1b[32m${timestamp}\x1b[0m`; // Green for info
  } else if (level === "error") {
    colorizedTimestamp = `\x1b[31m${timestamp}\x1b[0m`; // Red for error
  } else if (level === "warn") {
    colorizedTimestamp = `\x1b[33m${timestamp}\x1b[0m`; // Yellow for warn
  }
  return `${colorizedTimestamp} [${level.toUpperCase()}]:\n${message}`;
});

// Create logger
/**
 * Custom logger service using Winston with daily rotation and colorized output.
 * @module logger
 * @description Logger service using Winston with daily rotation and colorized output.
 * @requires winston
 * @requires winston-daily-rotate-file
 * @exports logger
 * @type {Logger} - Winston logger instance with daily rotation and colorized output.
 * @example
 * import logger from './services/logger';
 * 
 * logger.info('This is an info message');
 * logger.error('This is an error message');
 * logger.warn('This is a warning message');
 */
const logger = createLogger({
  level: "info",
  format: combine(timestamp({ format: "DD-MM-YYYY HH:mm:ss" }), logFormat),
  transports: [
    new transports.Console(),
    // Daily log file rotation
    new transports.DailyRotateFile({
      filename: "logs/winston_logger/application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
    // Separate log file for errors
    new transports.DailyRotateFile({
      level: "error",
      filename: "logs/winston_logger/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
    // Separate log file for warnings
    new transports.DailyRotateFile({
      level: "warn",
      filename: "logs/winston_logger/warn-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
});

export default logger;
