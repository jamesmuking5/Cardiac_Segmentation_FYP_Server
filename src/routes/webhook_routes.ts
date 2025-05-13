
import express, { Request, Response, NextFunction } from "express";
import { isAuth } from "../services/passportjs";
import logger from "../services/logger"; // Import Winston Logger
import { startInference } from "../services/inference"; // Import startInference function
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware"; // Import GPU auth middleware
import { updateJob } from "../services/database"; // Import database function to update job status
import { JobStatus } from "../types/database_types"; // Import JobStatus enum 

const serviceLocation = "InferenceCallback(Webhook)";
const router = express.Router();

// Route to start inference for a specific project
router.post("/start-inference/:projectId", isAuth, injectGpuAuthToken, async (req: Request, res: Response, next: NextFunction) => {
    const { projectId } = req.params;
    try {
        logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
        const result = await startInference(projectId, req.user, res.locals.gpuAuthToken); // Pass the token here
        if (result.success) {
            res.status(200).json({ message: result.message, uuid: result.uuid }); // Return the UUID to the client
        } else {
            res.status(500).json({ message: result.message });
        }
    } catch (error) {
        next(error);
    }
});

router.post("/api/gpu-webhook", async (req: Request, res: Response) => {
    logger.info(`${serviceLocation}: Received callback from Cloud GPU. Headers:`, req.headers, "Body:", req.body);

    // Extract the X-Job-ID from the request headers
    const gpuJobId = req.headers['x-job-id'] as string | undefined;

    // Log the received Job ID for debugging
    if (gpuJobId) {
        logger.info(`${serviceLocation}: Cloud GPU Job ID received in header: ${gpuJobId}`);
    } else {
        logger.error(`${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers. Body:`, req.body);
        return res.status(400).send("Missing Cloud GPU Job ID in headers");
    }

    const { status, result, message } = req.body; // Adjust based on the Cloud GPU's callback payload

    if (!status) {
        logger.error(`${serviceLocation}: Callback missing status.`);
        return res.status(400).send("Missing status in callback body");
    }

    let jobStatus: JobStatus;
    if (status === 'success') {
        jobStatus = JobStatus.COMPLETED;
    } else if (status === 'failed') {
        jobStatus = JobStatus.FAILED;
    } else if (status === 'processing') {
        jobStatus = JobStatus.IN_PROGRESS;
    } else {
        jobStatus = JobStatus.PENDING; // Or handle unknown statuses appropriately
    }

    try {
        // Use the gpuJobId to update job record
        const updateResult = await updateJob(gpuJobId, { status: jobStatus, result: result, message: message });
        if (!updateResult.success) {
            logger.error(`${serviceLocation}: Failed to update job with GPU Job ID ${gpuJobId} status: ${updateResult.message || "Unknown error"}`);
            return res.status(500).send("Failed to update job status");
        }
        logger.info(`${serviceLocation}: Successfully updated job with GPU Job ID ${gpuJobId} to status ${jobStatus}.`);
        return res.status(200).send("Job status updated");
    } catch (error) {
        logger.error(`${serviceLocation}: Unexpected error while updating job with GPU Job ID ${gpuJobId}: ${(error instanceof Error) ? error.message : "Unknown error"}`);
        return res.status(500).send("Unexpected error occurred");
    }
});


export default router;