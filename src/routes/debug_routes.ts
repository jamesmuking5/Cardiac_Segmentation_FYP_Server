// DEBUG only - Strictly do not use in production
import express, { Request, Response } from "express";
import { getCurrentToken } from "../services/gpu_auth_client"; // Import the function to get the current token
const router = express.Router();
import logger from "../services/logger"; // Import the logger
import LogError from "../utils/error_logger"; // Import the error logging utility
import { jobModel, createJob, readJob, updateJob, deleteJob, JobStatus, IJobDocument, IJob } from "../services/database"; // Import the job model and functions
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { v4 as uuidv4 } from "uuid"; // Import UUID generator
import { isAuth } from "../services/passportjs"; // Import the authentication middleware
import axios from "axios"; // Import axios for HTTP requests

// fetch env variables
const { HOST, PORT, NODE_ENV, GPU_SERVER_URL, GPU_SERVER_PORT, GPU_SERVER_SSL } = process.env; // Fetch environment variables for host and port

const serviceLocation = "API (Debug Route)"; // Define a service location for logging

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

router.get("/get-gpu_token", async (req: Request, res: Response): Promise<void> => {
    const token = getCurrentToken(); // Get the current token
    if (token) {
        res.status(200).json({ token });
    } else {
        res.status(500).json({ error: "Failed to retrieve GPU token." });
    }
});

// route to start bbox inferencing via the gpu with self-generated callback_url (below), presigned_url, uuid
router.get('/start-bbox-inferencing', /*isAuth,*/ injectGpuAuthToken, async (req: Request, res: Response): Promise<void> => {
    logger.warn("DEBUG: Starting bbox inferencing..."); // Log the start of the process
    // Create sample job data
    const uuid = uuidv4(); // Generate a unique UUID for the job
    const url = "https://devel-visheart-s3-bucket.s3.ap-southeast-1.amazonaws.com/source_nifti/test-folder-dont-delete/smalltarsample.tar?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAQB4Y5V67VM7VJVOC%2F20250504%2Fap-southeast-1%2Fs3%2Faws4_request&X-Amz-Date=20250504T105403Z&X-Amz-Expires=10000&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEGsaDmFwLXNvdXRoZWFzdC0xIkYwRAIgK8FVARAaP3WSoSF2%2BMJY2ztdJNVpee9vCaC9wdWKwUcCIBy2rGID8wEUkLLyUHdbuuN0Ej1ROhsOhsfrHYWAKPHhKskFCBQQABoMMDA0MDc4ODA5MDIzIgwd8Xqlb4dAunVE5SgqpgXFs%2B1ksXKMQqz5g%2Fb3f7PK8X0t%2Fjr5kmUhZZ1w2H30aRKoWw5ksEDke%2FVaIEqGa1MLxdO1pv61INnBucGjF7sLVE1o%2BRi0xrXDBiCSJ%2BKodNwUD2vbe9IZpm8FPu6zltuCgTOWcrVYfhSJugEfX0JgMEZULhAZ1hJBFFvIMqhWnNty1yDItIGMjD6b9tsl%2BX7GWHqtXMll%2BeWYWH4%2FiTxOTFZgUTP8fHaJhi72aJLlejZmxYA4Y0M%2BG579VqVZSKjNYdl7UFHf0RYfvOeuYGAgGdnE0%2BZUyupxiWoXtlcqNMnXXFbYCmWEZ2ddTl9R7R4uDKsvJjtgtMzSpjmuL6sYrYiWdzO%2F2aiD%2FhEFTqSOKyq1QLzFwCcMOKtcDDa8A%2Fes67slhw7BWLSzj8UDk9vQp07nKpKApn%2FHvghMKCL3HGrMyrfhOgQcHiOW2Zl0%2FsEskrKwbo7Gd9qR4qQHY6BIVb8Scbv%2BsBZiup0weqSqmaq2MNoEQu%2BloUN5Cy5CEsMa2m84fm9zgk%2B%2BnmzsrZeFDzpNkL%2B1E%2BTMwNeiJQCSl00AxVpvqMb2TsdsDH0Us8c48InaLq6bV1A8d%2BdVlKb4dSrKOTXyUaWFCdhNKHP01%2B9yUF4%2F9ZRl4j19LM6Vz8LzSnOrGepkoWBVNUf9gzGhg9ayS9PwMSOQ92o%2BOx%2FTuzGYyF99KAQMCsWYgwn1xabfuQu4KRlG%2BkZgd8CB7OvenVwEDjBn0zNUtLG4lJzyerfIVzzOTkLBqY4xgy3eSEfdFuw%2BS6cC9bpbPxsUyew4BbDBtpLU1MK7IgeuWJJjvrvm%2BoZwCMuC0uqsOrM6112jcScQCT2ohgNEHsOz3o0Kunm0auY66o1XN%2FYE7LM38120BdoKd%2Fdm3Bfk79NwyowsfFqBazowwo7dwAY6swHFe8Q9dUctlyEHs2uZ2tpWOi%2Bv72v%2F2LD4%2BpMQBQv3JO%2FKwfwd%2B%2B2tLUOBN59i9QdODtmd2K23clS3nEe%2B3H%2FFMP3rG7eHC4IOO4faNbhkj2emgtE7hjHQyzO8JuPkNA67aObLoBC3st2JMdpunHuNDZiEqpAjjWykjWGy4HgFfI%2BrRerg0Dtg9wZJQCiyvojMNW8YAR2RMQwHNJNqe3dqymjRE%2BXZ0TKJam%2FZqOODf4ulIQ%3D%3D&X-Amz-Signature=5d74b5d4c12343217ee67cb6d83dacf345b7046b2b5daf380b9efee254f19fe7&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"; // Presigned URL for the source NIfTI file
    const httpOrHttps = NODE_ENV === "development" ? "http" : "https"; // Use http for development and https for production
    const callback_url = `${httpOrHttps}://192.168.0.2:${PORT}/gpu-webhook`; // Callback URL for the webhook

    const gpuHttpOrHttps = GPU_SERVER_SSL === "true" ? "https" : "http";
    const GPU_SERVER_ADDRESS = `${gpuHttpOrHttps}://${GPU_SERVER_URL}:${GPU_SERVER_PORT}`; // Construct the full address
    const fullAddress = `${GPU_SERVER_ADDRESS}/inference/medsam-inference`; // Full address for the GPU server

    // use axios to send a POST request to the GPU server with the job data
    try {
        const job: IJob = {
            userid: "dummyUserId", // Replace with actual user ID if available
            projectid: "dummyProjectId", // Replace with actual project ID if available
            uuid: uuid,
            status: JobStatus.PENDING,
        };
        // Create a new job in the database
        const createResult = await createJob(job);

        if (!createResult.success) {
            logger.error(`${serviceLocation}: Failed to create job in database: ${createResult.message}`);
            res.status(500).json({ error: "Failed to create job in database." });
            return;
        }
        logger.info(`${serviceLocation}: Job ${uuid} created in database successfully`)

        const response = await axios.post(
            `${GPU_SERVER_ADDRESS}/inference/bbox-inference`,
            {  // This is the request body
                url: url,
                callback_url: callback_url,
                uuid: uuid,
            },
            {  // This is the axios configuration
                headers: {
                    Authorization: `Bearer ${res.locals.gpuAuthToken}`,
                },
                timeout: 10000,
            }
        );
        if (response.status === 202) {
            logger.info(`${serviceLocation}: GPU server started job successfully`);
            res.status(200).json({
                message: "Job started successfully.",
                status: "online",
                uuid: uuid,
                gpuServerResponse: response.data
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
                logger.error(`${serviceLocation}: Connection refused to GPU server at ${fullAddress}`);
                errorDetails = { code: 'ECONNREFUSED', serverAddress: fullAddress };
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
})

// webhook to receive the result of the bbox inferencing
router.post('/gpu-webhook', async (req: Request, res: Response): Promise<void> => {
    logger.info(`${serviceLocation}: Received webhook from GPU server`, req.body);

    // Extract all fields from the callback payload
    const { uuid, status, result, error_detail } = req.body;

    // Validate required fields
    if (!uuid) {
        logger.warn(`${serviceLocation}: Missing uuid in webhook payload`);
        res.status(400).json({ error: "Missing uuid in the request body" });
        return;
    }

    try {
        // First, check if the job exists
        const jobResult = await readJob(uuid);

        if (!jobResult.success) {
            logger.warn(`${serviceLocation}: Job ${uuid} not found in database during webhook processing`);
            res.status(404).json({ error: `Job with uuid ${uuid} not found` });
            return;
        }

        // Get the results of the bounding boxes here:
        // logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
        // logger.info(`Error details: ${JSON.stringify(error_detail, null, 2)}`);

        // Map the status from the callback to our JobStatus enum
        let newStatus: JobStatus;
        if (status === "completed") {
            newStatus = JobStatus.COMPLETED;
        } else if (status === "failed") {
            newStatus = JobStatus.FAILED;
        } else {
            // Default case for unknown status
            newStatus = JobStatus.FAILED;
            logger.warn(`${serviceLocation}: Unknown job status "${status}" received for ${uuid}`);
        }

        // Update the job status in the database
        const updateResult = await updateJob(uuid, { status: newStatus, message: req.body.message });
        logger.info(`${serviceLocation}: Updating job ${uuid} status to ${newStatus} with ${updateResult.success ? "success" : "failure"}`);

        // ALERT: this section should update the segmentation mask related to the job in the database

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        LogError(
            error instanceof Error ? error : new Error(errorMessage),
            serviceLocation,
            `Error processing webhook for job ${uuid}`
        );
        logger.error(`${serviceLocation}: Error processing webhook:`, error);

        res.status(500).json({
            error: "Internal server error while processing webhook",
            message: errorMessage
        });
    } finally {
        // Make sure we always respond to the GPU server
        if (!res.headersSent) {
            res.status(200).json({ message: "Webhook received" });
        }
    }
});

export default router; // Export the router for use in the main app