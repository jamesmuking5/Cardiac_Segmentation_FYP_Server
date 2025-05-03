// File: src/routes/gpu_status.ts
// Description: Routes for testing GPU token authentication and status.
import express, { Request, Response } from "express";
import axios from "axios"; // Import axios for HTTP requests

// Import the middleware to require GPU auth token
import { requireGpuAuthToken } from "../middleware/gpuauthmiddleware";
import LogError from "../utils/error_logger";
import logger from "../services/logger";
const router = express.Router();

const serviceLocation = "API (GPU Status Route)";

// get GPU address from environment variables
const GPU_SERVER_URL = process.env.GPU_SERVER_URL || "localhost"; // Default to localhost if not set
const GPU_SERVER_PORT = process.env.GPU_SERVER_PORT || 80; // Default to 443 if not set
const GPU_SERVER_SSL = process.env.GPU_SERVER_SSL === "true" ? true : false; // Convert to boolean

// Construct the full address
const GPU_SERVER_ADDRESS = `${GPU_SERVER_SSL ? "https" : "http"}://${GPU_SERVER_URL}:${GPU_SERVER_PORT}`;

// Define a type guard for checking axios errors
interface AxiosErrorLike {
  isAxiosError?: boolean;
  response?: {
    status: number;
    data: any;
  };
  request?: any;
  code?: string;
  message?: string;
}

function isAxiosErrorLike(error: any): error is AxiosErrorLike {
  return error && typeof error === 'object' && 'isAxiosError' in error;
}

// Returns if Cloud GPU is available
router.get("/gpu-sample-image",
    requireGpuAuthToken,
    async (req: Request, res: Response): Promise<void> => {
        // Make authenticated request to the GPU server
        try {
            const fullAddress = `${GPU_SERVER_ADDRESS}/inference/sample`;
            logger.info(`${serviceLocation}: Checking GPU status at ${fullAddress}`);
            
            const response = await axios.get(fullAddress, {
                headers: {
                    Authorization: `Bearer ${res.locals.gpuAuthToken}`,
                },
                timeout: 10000, // Add a 10-second timeout
            });
            
            if (response.status === 200) {
                logger.info(`${serviceLocation}: GPU is available`);
                res.status(200).json({
                    message: "GPU is available.",
                    status: "online"
                });
            } else {
                logger.warn(`${serviceLocation}: GPU returned non-200 status: ${response.status}`);
                res.status(response.status).json({
                    message: `GPU returned status ${response.status}`,
                    status: "degraded",
                    details: response.data
                });
            }
        }
        catch (error: any) { // Use 'any' as the error type to avoid TypeScript issues
            // Detailed error handling
            let errorMessage = "GPU is not available.";
            let statusCode = 503;
            let errorDetails: Record<string, any> = {};
            
            if (isAxiosErrorLike(error)) {
                // Handle specific axios errors
                if (error.code === 'ECONNREFUSED') {
                    errorMessage = "Connection to GPU server refused. The server may be down.";
                    logger.error(`${serviceLocation}: Connection refused to GPU server at ${GPU_SERVER_ADDRESS}`);
                    errorDetails = { code: 'ECONNREFUSED', serverAddress: GPU_SERVER_ADDRESS };
                } 
                else if (error.code === 'ETIMEDOUT') {
                    errorMessage = "Connection to GPU server timed out. The server may be overloaded.";
                    logger.error(`${serviceLocation}: Connection timeout to GPU server`);
                    errorDetails = { code: 'ETIMEDOUT' };
                }
                else if (error.response) {
                    // The server responded with a status code outside of 2xx
                    statusCode = error.response.status;
                    errorMessage = `GPU server returned error: ${error.response.status}`;
                    logger.error(`${serviceLocation}: GPU server returned error status ${error.response.status}`);
                    errorDetails = { 
                        status: error.response.status,
                        data: error.response.data
                    };
                } 
                else {
                    // Something else happened while setting up the request
                    errorMessage = error.message || "Unknown error occurred connecting to GPU server";
                    logger.error(`${serviceLocation}: Request setup error: ${error.message}`);
                    errorDetails = { code: error.code };
                }
            } else if (error instanceof Error) {
                // For standard Error objects
                errorMessage = error.message || "Unknown error";
                logger.error(`${serviceLocation}: Standard error: ${errorMessage}`);
                errorDetails = { name: error.name };
            } else {
                // For any other type of error
                errorMessage = String(error);
                logger.error(`${serviceLocation}: Non-standard error: ${errorMessage}`);
            }
            
            // Use the consistent serviceLocation for error logging
            LogError(error, serviceLocation, `Error while checking GPU status: ${errorMessage}`);
            
            res.status(statusCode).json({
                message: errorMessage,
                status: "offline",
                details: errorDetails
            });
        }
    });

export default router;