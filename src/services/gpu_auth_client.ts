/**
 * @file src/services/gpu_auth_client.ts
 * @module gpu_auth_client
 * @description Manages authentication with the GPU server by self-generating
 * short-lived JWTs and automatically refreshing them.
 * This client acts on behalf of the Node.js server itself when
 * communicating with the GPU/FastAPI server.
 */

import jwt from "jsonwebtoken";
import logger from "./logger"; // Assuming Winston logger instance
import LogError from "../utils/error_logger"; // Assuming custom error logging utility
import crypto from "crypto"; // Used for generating unique JWT IDs (jti claim)
import axios from "axios"; // For making HTTP requests to the GPU server

// get GPU address from environment variables
const GPU_SERVER_URL = process.env.GPU_SERVER_URL || "localhost"; // Default to localhost if not set
const GPU_SERVER_PORT = process.env.GPU_SERVER_PORT || 80; // Default to 443 if not set
const GPU_SERVER_SSL = process.env.GPU_SERVER_SSL === "true" ? true : false; // Convert to boolean

// Construct the full address
const GPU_SERVER_ADDRESS = `${GPU_SERVER_SSL ? "https" : "http"}://${GPU_SERVER_URL}:${GPU_SERVER_PORT}`;

/**
 * Service location identifier for logging purposes within this module.
 * @constant {string}
 */
const serviceLocation = "API(GPU Authentication)";

// --- Configuration loaded from Environment Variables ---

/**
 * The shared secret key used for signing JWTs (HS256) by this Node.js client
 * and verifying them by the GPU/FastAPI server.
 * **CRITICAL:** Must be kept secret and match the key used by the GPU server.
 * Loaded from `process.env.GPU_SERVER_AUTH_JWT_SECRET`.
 * @constant {string | undefined}
 */
const GPU_SERVER_AUTH_JWT_SECRET = process.env.GPU_SERVER_AUTH_JWT_SECRET;

/**
 * The identifier for this Node.js server instance/service.
 * Used as the 'subject' (`sub`) and 'issuer' (`iss`) claims within the generated JWT
 * to identify who the token represents and who issued it.
 * Loaded from `process.env.SERVER_ID_FOR_GPU_SERVER`, defaults to "gpu_server_auth".
 * @constant {string}
 */
const SERVER_ID_FOR_GPU_SERVER = process.env.SERVER_ID_FOR_GPU_SERVER || "gpu_server_auth";

/**
 * The identifier representing the intended recipient (audience) of the generated JWTs,
 * which is the GPU/FastAPI server itself. Used in the 'audience' (`aud`) claim.
 * The GPU server should verify this claim matches its own identity.
 * Loaded from `process.env.GPU_SERVER_IDENTITY`, defaults to "gpu_server_identity".
 * @constant {string}
 */
const GPU_SERVER_IDENTITY = process.env.GPU_SERVER_IDENTITY || "gpu_server_identity";

/**
 * Interval (in milliseconds) at which the JWT should be automatically regenerated
 * and stored, before the previous one expires. Set slightly shorter than the
 * token lifetime to ensure a valid token is usually available.
 * Defaults to 8 minutes.
 * @constant {number}
 */
const JWT_REFRESH_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

/**
 * The duration (in seconds) for which each generated JWT will be valid.
 * Corresponds to the `exp` (expiration time) claim in the JWT payload.
 * Defaults to 10 minutes.
 * @constant {number}
 */
const JWT_LIFETIME_SECONDS = 10 * 60; // 10 minutes

// --- Module State ---

/**
 * Stores the most recently generated valid JWT string.
 * This variable holds the actual Bearer token used for API calls.
 * Initialized to `null` and updated periodically by the refresh mechanism.
 * @private
 * @type {string | null}
 */
let currentJwt: string | null = null;

/**
 * Stores the expiration timestamp (in milliseconds since the Unix epoch, UTC)
 * of the `currentJwt`. Used by `getCurrentToken` to check validity.
 * Initialized to `null` and updated whenever a new JWT is generated.
 * @private
 * @type {number | null}
 */
let tokenExpiresAt: number | null = null;

/**
 * Holds the `Timeout` object returned by `setInterval` used for scheduling
 * the periodic JWT refresh. Used by `stopTokenRefresh` to clear the interval
 * during graceful shutdown.
 * Initialized to `null`.
 * @private
 * @type {NodeJS.Timeout | null}
 */
let refreshIntervalId: NodeJS.Timeout | null = null;

/**
 * @function generateAndStoreJwt
 * @private
 * @description Generates a new JWT using the configured secret and identity,
 * signs it, and stores it along with its expiration time in the
 * module's state variables (`currentJwt`, `tokenExpiresAt`).
 * Logs success or errors encountered during generation.
 * @throws {Error} If essential environment variables (`GPU_SERVER_AUTH_JWT_SECRET`,
 * `SERVER_ID_FOR_GPU_SERVER`, `GPU_SERVER_IDENTITY`) are missing.
 * @throws {Error} If the `jwt.sign` operation fails.
 * @returns {void}
 */
function generateAndStoreJwt(): void {
    // --- Validate configuration ---
    if (!GPU_SERVER_AUTH_JWT_SECRET) {
        // LogError is called in the catch block, throwing ensures immediate failure
        throw new Error("GPU_SERVER_AUTH_JWT_SECRET is not defined in the environment variables.");
    }
    if (!SERVER_ID_FOR_GPU_SERVER) {
        throw new Error("SERVER_ID_FOR_GPU_SERVER is not defined in the environment variables.");
    }
    if (!GPU_SERVER_IDENTITY) {
        throw new Error("GPU_SERVER_IDENTITY is not defined in the environment variables.");
    }

    try {
        // --- Calculate Timestamps ---
        const nowSeconds = Math.floor(Date.now() / 1000); // Current time in seconds
        const expiresSeconds = nowSeconds + JWT_LIFETIME_SECONDS; // Expiration time in seconds

        // --- Define JWT Payload ---
        const payload = {
            sub: SERVER_ID_FOR_GPU_SERVER, // Subject: Who this token represents
            iss: SERVER_ID_FOR_GPU_SERVER, // Issuer: Who created this token
            iat: nowSeconds,             // Issued At: When the token was created
            exp: expiresSeconds,           // Expiration Time: When the token becomes invalid
            aud: GPU_SERVER_IDENTITY,    // Audience: Who this token is intended for
            jti: crypto.randomBytes(16).toString('hex'), // JWT ID: Unique identifier for this specific token
        };

        // --- Sign the JWT ---
        const newJwt = jwt.sign(payload, GPU_SERVER_AUTH_JWT_SECRET, {
            algorithm: "HS256", // Specify the algorithm consistent with the secret type
        });

        // --- Store the new token and its expiration ---
        currentJwt = newJwt;
        tokenExpiresAt = expiresSeconds * 1000; // Store expiration in milliseconds

        // Use verbose logging for the token itself only if necessary for debugging
        // logger.info(`Generated new JWT: ${currentJwt}`);
        logger.info(`${serviceLocation}: Successfully generated new JWT. Expires: ${new Date(tokenExpiresAt).toISOString()}`);

    } catch (error: unknown) {
        logger.error(`${serviceLocation}: Error generating JWT`, { error }); // Log the error object
        LogError(error as Error, serviceLocation, `Error generating JWT`);
        // Clear potentially invalid state after failure
        currentJwt = null;
        tokenExpiresAt = null;
        // Re-throw to signal failure to the caller (initAndRefreshAuth)
        throw error;
    }
}

async function checkGpuStatusOnInitialization(): Promise<void> {
    // This function is called to check the GPU status on initialization
    // It can be used to verify if the GPU server is reachable and operational
    try {
        const fullAddress = `${GPU_SERVER_ADDRESS}/status/gpu`;
        const response = await axios.get(fullAddress, { timeout: 10000, });// Add a 10-second timeout
        if (response.status === 200) {
            logger.info(`${serviceLocation}: GPU server is reachable and operational.`);
        }
    }
    catch(error:unknown){
        logger.warn(`${serviceLocation}: GPU server is not reachable or operational.`, { error });
    }
    
}

/**
 * @function initAndRefreshAuth
 * @description Initializes the GPU server authentication process. It performs
 * an immediate generation of the first JWT and then sets up a
 * `setInterval` timer to automatically regenerate the JWT based on
 * `JWT_REFRESH_INTERVAL_MS` before the old one expires.
 * This function should be called once during application startup.
 * @throws {Error} If the *initial* JWT generation fails (e.g., due to missing env vars),
 * the error is re-thrown to potentially halt application startup.
 * @returns {void}
 */
function initAndRefreshAuth(): void {
    // Ensure any previous interval is cleared if this function were ever called again
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }

    logger.info(`${serviceLocation}: Initializing GPU server authentication and starting refresh timer.`);
    try {
        // Generate the first token immediately. If this fails, an error will be thrown.
        generateAndStoreJwt();

        // Schedule subsequent token refreshes
        refreshIntervalId = setInterval(() => {
            logger.info(`${serviceLocation}: Refreshing the JWT token for GPU server authentication.`);
            try {
                // Generate and store the new token in the background
                generateAndStoreJwt();
            } catch (refreshError) {
                // Log errors during refresh but don't crash the application
                // The previous token might still be valid for a short while.
                logger.error(`${serviceLocation}: Failed to refresh JWT during scheduled interval:`, { error: refreshError });
                LogError(refreshError as Error, serviceLocation, `Error refreshing JWT`);
            }
        }, JWT_REFRESH_INTERVAL_MS); // Refresh based on the defined interval

        logger.info(`${serviceLocation}: JWT refresh scheduled every ${JWT_REFRESH_INTERVAL_MS / 1000 / 60} minutes.`);

    } catch (initialError) {
        // Log the critical failure during initial generation
        logger.error(`${serviceLocation}: CRITICAL - Failed during initial JWT generation.`, { error: initialError });
        LogError(initialError as Error, serviceLocation, `Critical error - initializing GPU server authentication`);
        // Rethrow the error so the main application startup process knows initialization failed
        throw initialError;
    }
}

/**
 * @function getCurrentToken
 * @description Retrieves the most recently generated JWT string, provided it exists
 * and has not expired (considering a small buffer). Intended to be called
 * just before making an authenticated request to the GPU server.
 * @returns {string | null} The current valid JWT string, or `null` if no valid token
 * is currently available (e.g., initialization failed, token
 * expired and refresh is pending, or refresh failed).
 */
function getCurrentToken(): string | null {
    if (!currentJwt) {
        logger.warn(`${serviceLocation}: Attempted to get JWT, but none is available. Initialization might have failed or is pending.`);
        return null;
    }

    // Check if the token is expired or about to expire (using a buffer)
    const bufferSeconds = 30; // Check 30 seconds before actual expiry for safety margin
    if (!tokenExpiresAt || Date.now() >= tokenExpiresAt - (bufferSeconds * 1000)) {
        logger.warn(`${serviceLocation}: Current JWT is expired or nearing expiration (expires: ${tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : 'N/A'}). Waiting for refresh interval.`);
        // Return null because the current token is considered invalid for use.
        // The background refresh should provide a new one soon.
        return null;
    }

    // Token exists and is within its validity period (including buffer)
    return currentJwt;
}

/**
 * @function stopTokenRefresh
 * @description Clears the `setInterval` timer responsible for periodically refreshing
 * the JWT. This should be called during a graceful shutdown sequence of the
 * Node.js application to prevent the timer callback from executing during
 * or after shutdown.
 * @returns {void}
 */
function stopTokenRefresh(): void {
    if (refreshIntervalId) {
        logger.info(`${serviceLocation}: Stopping JWT refresh interval...`);
        clearInterval(refreshIntervalId);
        refreshIntervalId = null; // Clear the reference
    }
}

// Export the public functions needed by the rest of the application
export { initAndRefreshAuth, getCurrentToken, stopTokenRefresh, checkGpuStatusOnInitialization };