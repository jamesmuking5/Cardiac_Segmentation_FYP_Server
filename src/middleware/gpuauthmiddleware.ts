// File: src/middleware/gpuAuthMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { getCurrentToken } from '../services/gpu_auth_client'; // Adjust path if needed
import logger from '../services/logger'; // Adjust path if needed
import LogError from '../utils/error_logger'; // Adjust path if needed

const serviceLocation = "Middleware(GPUAuth)";

/**
 * Express middleware to ensure a valid JWT for the GPU server is available.
 * It retrieves the current token using `getCurrentToken()` and attaches it
 * to `res.locals.gpuAuthToken` for downstream route handlers to use.
 * If no valid token is available, it sends a 503 Service Unavailable response
 * and stops the request chain.
 *
 * @param req - Express Request object.
 * @param res - Express Response object.
 * @param next - Express NextFunction callback.
 */
export function injectGpuAuthToken(req: Request, res: Response, next: NextFunction): void {
    const token = getCurrentToken();

    if (!token) {
        logger.warn(`${serviceLocation}: Denying request to ${req.originalUrl} - GPU auth token not available or expired.`);
        // Log the error for debugging why token might be missing
        LogError(new Error("GPU Auth Token Unavailable"), serviceLocation, `Attempted access to ${req.originalUrl} without valid token.`);

        res.status(503).json({
            error: 'Service temporarily unavailable',
            detail: 'Cannot authenticate with dependent service at the moment.',
        });
        // Stop processing the request chain
        return;
    }

    // Token is available and likely valid (basic check done in getCurrentToken)
    // Attach the token to res.locals for the route handler to use
    // res.locals is a standard place to pass data between middleware
    res.locals.gpuAuthToken = token;
    logger.info(`${serviceLocation}: Valid GPU auth token found for request to ${req.originalUrl}. Proceeding.`);

    // Pass control to the next middleware or route handler
    next();
}