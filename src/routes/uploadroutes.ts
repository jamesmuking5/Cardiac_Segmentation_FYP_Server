// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response, NextFunction } from "express";
import { upload } from "../middleware/uploadmiddleware";
import { handleUpload } from "../services/upload";
import { isAuth } from "../services/passportjs";
import logger from "../services/logger"; // Import Winston Logger
import { startInference } from "../services/inference"; // Import startInference function
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware"; // Import GPU auth middleware
import { updateJob } from "../services/database"; // Import database function to update job status
import { JobStatus } from "../types/database_types"; // Import JobStatus enum 

const serviceLocation = "API(Upload)";
const router = express.Router();

// Upload route with PUT method
router.put("/upload", isAuth, upload.any(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info(`${serviceLocation}: Received file upload request from user ${req.user?.username} with id ${req.user?._id}`);
    await handleUpload(req, res);
  } catch (error) {
    next(error);
  }
});

// Informative GET route
router.get("/upload", (req: Request, res: Response) => {
  res.send("Use PUT method to upload files.");
});

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
    logger.info(`${serviceLocation}: Received callback from Cloud GPU. Body:`, req.body);
    const { uuid, status, result, message } = req.body; // Adjust based on the Cloud GPU's callback payload

    if (!uuid) {
        logger.error(`${serviceLocation}: Callback missing job UUID.`);
        return res.status(400).send("Missing job UUID");
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
        const updateResult = await updateJob(uuid, { status: jobStatus, result: result, message: message }); // Changed from updateJobByUuid to updateJob
        if (!updateResult.success) {
            logger.error(`${serviceLocation}: Failed to update job ${uuid} status: ${updateResult.message || "Unknown error"}`);
            return res.status(500).send("Failed to update job status");
        }
        logger.info(`${serviceLocation}: Successfully updated job ${uuid} to status ${jobStatus}.`);
        return res.status(200).send("Job status updated");
    } catch (error) {
        logger.error(`${serviceLocation}: Unexpected error while updating job ${uuid}: ${(error instanceof Error) ? error.message : "Unknown error"}`);
        return res.status(500).send("Unexpected error occurred");
    }
});

// Get project routes?
// Get project information routes?
// Get mask routes?

export default router;