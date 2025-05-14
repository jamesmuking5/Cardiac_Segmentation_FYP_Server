
import express, { Request, Response, NextFunction } from "express";
import { isAuth } from "../services/passportjs";
import logger from "../services/logger"; // Import Winston Logger
import { startInference } from "../services/inference"; // Import startInference function
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware"; // Import GPU auth middleware
import { updateJob, createProjectSegmentationMask } from "../services/database"; // Import database function to update job status
import { JobStatus, IProjectSegmentationMask, ComponentBoundingBoxesClass, CRUDOperation, IJob } from "../types/database_types"; // Import JobStatus enum and IJob type
import LogError from "../utils/error_logger";

const serviceLocation = "InferenceCallback(Webhook)";
const router = express.Router();

// Route to start inference for a specific project
router.post("/start-inference/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId } = req.params;
        logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
        try {
            logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
            const result = await startInference(projectId, req.user, res.locals.gpuAuthToken); // Pass the token here
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid }); // Return the UUID to the client
            } else {
                res.status(500).json({ message: result.message });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting inference");
        }
    });

router.post("/api/gpu-webhook", async (req: Request, res: Response) => {
    logger.info(`${serviceLocation}: Received callback from Cloud GPU. Headers:`, req.headers, "Body:", req.body);

    const gpuJobId = req.headers['x-job-id'] as string | undefined;

    if (gpuJobId) {
        logger.info(`${serviceLocation}: Cloud GPU Job ID received in header: ${gpuJobId}`);
    } else {
        logger.error(`${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers. Body:`, req.body);
        return res.status(400).json("Missing Cloud GPU Job ID in headers");
    }

    // MODIFIED: Destructure 'error' instead of 'message' for error details
    // MODIFIED: 'status' from Python will be 'completed' or 'failed'
    // 'result' from Python is 'gpuResult'
    const { status, result: gpuResult, error: gpuErrorDetail } = req.body; 

    if (!status) {
        logger.error(`${serviceLocation}: Callback missing status for job UUID ${gpuJobId}.`);
        return res.status(400).json({ message: "Missing status in callback body" });
    }

    let jobStatus: JobStatus;
    let jobMessage: string | undefined = gpuErrorDetail ? (typeof gpuErrorDetail === 'string' ? gpuErrorDetail : JSON.stringify(gpuErrorDetail)) : undefined;

    if (status === 'completed' || status === 'success') { // Handle 'success' as 'completed'
        jobStatus = JobStatus.COMPLETED;
    } else if (status === 'failed') {
        jobStatus = JobStatus.FAILED;
    } else if (status === 'processing') { 
        jobStatus = JobStatus.IN_PROGRESS;
    } else {
        logger.warn(`${serviceLocation}: Unknown status received: ${status}. Defaulting to PENDING.`);
        jobStatus = JobStatus.PENDING;
        if (!jobMessage) jobMessage = `Unknown status received from GPU: ${status}`;
    }

    try {
        const jobUpdatePayload: Partial<IJob> = { 
            status: jobStatus,
            // Store raw result as string in the Job document
            result: gpuResult ? (typeof gpuResult === 'string' ? gpuResult : JSON.stringify(gpuResult)) : undefined,
            message: jobMessage
        };
        
        const updateResult = await updateJob(gpuJobId, jobUpdatePayload);

        if (!updateResult.success || !updateResult.job) {
            logger.error(`${serviceLocation}: Failed to update job with GPU Job ID ${gpuJobId}. Reason: ${updateResult.message || "Job not found after update"}`);
            return res.status(500).json({ message: `Failed to update job status or retrieve job after update: ${updateResult.message}` });
        }
        logger.info(`${serviceLocation}: Successfully updated job with GPU Job ID ${gpuJobId} to status ${jobStatus}.`);

        // If job is completed and has results (gpuResult is the object form here), process and store structured segmentation masks
        if (jobStatus === JobStatus.COMPLETED && gpuResult && typeof gpuResult === 'object' && Object.keys(gpuResult).length > 0) {
            const currentJob = updateResult.job;
            const projectId = currentJob.projectid;
            // const userId = currentJob.userid; // userid is not part of IProjectSegmentationMask, linked via projectid

            logger.info(`${serviceLocation}: Processing structured segmentation results for job ${gpuJobId}, project ${projectId}`);

            const newSegmentationSet: Partial<IProjectSegmentationMask> = {
                projectid: projectId,
                name: `AI Output - Job ${gpuJobId.substring(0, 8)}`, // Example name
                description: `Automated segmentation results from inference job ${gpuJobId}`,
                isSaved: true,
                isMedSAMOutput: true, 
                segmentationmaskRLE: true, 
                frames: []
            };

            const framesDataMap = new Map<number, { frameindex: number; frameinferred: boolean; slices: Map<number, { sliceindex: number; componentboundingboxes: any[]; segmentationmasks: any[] }> }>();

            for (const [imageFilename, segmentationData] of Object.entries(gpuResult as Record<string, any>)) {
                // Ensure segmentationData is an object with 'boxes' or 'masks'
                if (typeof segmentationData !== 'object' || segmentationData === null) {
                    logger.warn(`${serviceLocation}: Invalid segmentation data for ${imageFilename} in job ${gpuJobId}. Skipping.`);
                    continue;
                }

                const filenameParts = imageFilename.replace(/\.jpg$/i, '').split('_'); // Case-insensitive .jpg removal
                let frameNumber: number | undefined;
                let sliceNumber: number | undefined;

                // Adjust parsing based on your exact filename structure from convert_to_jpeg.py
                // Example: "userid_projectid_frame_slice.jpg" or "somename_frame_slice.jpg"
                // This assumes frame and slice are the last two numeric parts if multiple underscores exist.
                if (filenameParts.length >= 2) { 
                    const potentialSlice = parseInt(filenameParts[filenameParts.length - 1], 10);
                    const potentialFrame = parseInt(filenameParts[filenameParts.length - 2], 10);
                    if (!isNaN(potentialSlice) && !isNaN(potentialFrame)) {
                        sliceNumber = potentialSlice;
                        frameNumber = potentialFrame;
                    } else {
                         logger.warn(`${serviceLocation}: Could not parse frame/slice numbers from filename parts for ${imageFilename} in job ${gpuJobId}`);
                    }
                }
                
                if (frameNumber === undefined || sliceNumber === undefined) {
                    logger.warn(`${serviceLocation}: Could not parse valid frame/slice from filename ${imageFilename} for job ${gpuJobId}. Skipping entry.`);
                    continue; 
                }

                if (!framesDataMap.has(frameNumber)) {
                    framesDataMap.set(frameNumber, {
                        frameindex: frameNumber,
                        frameinferred: true, 
                        slices: new Map()
                    });
                }
                const currentFrameData = framesDataMap.get(frameNumber)!;

                if (!currentFrameData.slices.has(sliceNumber)) {
                    currentFrameData.slices.set(sliceNumber, {
                        sliceindex: sliceNumber,
                        componentboundingboxes: [],
                        segmentationmasks: []
                    });
                }
                const currentSliceData = currentFrameData.slices.get(sliceNumber)!;

                if (segmentationData.boxes && Array.isArray(segmentationData.boxes)) {
                    for (const box of segmentationData.boxes) {
                        if (box && typeof box === 'object' && box.bbox && Array.isArray(box.bbox) && box.bbox.length === 4) {
                            currentSliceData.componentboundingboxes.push({
                                class: box.class_name || 'unknown', 
                                confidence: typeof box.confidence === 'number' ? box.confidence : 0,
                                x_min: box.bbox[0],
                                y_min: box.bbox[1],
                                x_max: box.bbox[2],
                                y_max: box.bbox[3]
                            });
                        } else {
                            logger.warn(`${serviceLocation}: Invalid box data for ${imageFilename}, class ${box?.class_name} in job ${gpuJobId}. Skipping box.`);
                        }
                    }
                }

                if (segmentationData.masks && typeof segmentationData.masks === 'object') {
                    for (const [className, rleString] of Object.entries(segmentationData.masks)) {
                        if (typeof rleString === 'string') {
                            currentSliceData.segmentationmasks.push({
                                class: className, 
                                segmentationmaskcontents: rleString
                            });
                        } else {
                             logger.warn(`${serviceLocation}: Invalid RLE string for ${imageFilename}, class ${className} in job ${gpuJobId}. Skipping mask.`);
                        }
                    }
                }
            }

            newSegmentationSet.frames = Array.from(framesDataMap.values()).map(f => ({
                ...f,
                slices: Array.from(f.slices.values()).sort((a, b) => a.sliceindex - b.sliceindex) 
            })).sort((a,b) => a.frameindex - b.frameindex); 

            if (newSegmentationSet.frames.length > 0) {
                const creationResult = await createProjectSegmentationMask(newSegmentationSet as IProjectSegmentationMask);
                if (creationResult.success) {
                    logger.info(`${serviceLocation}: Successfully created structured segmentation mask document for job ${gpuJobId}`);
                } else {
                    logger.error(`${serviceLocation}: Failed to create structured segmentation mask document for job ${gpuJobId}. Reason: ${creationResult.message}`);
                }
            } else {
                 logger.warn(`${serviceLocation}: No parsable frame/slice data found in GPU result for job ${gpuJobId}. Skipping structured segmentation storage.`);
            }
        }

        return res.status(200).json({ message: "Callback processed, job status updated." }); // More descriptive success message

    } catch (dbError) { 
        LogError(dbError as Error, serviceLocation, `Unexpected error while processing webhook for GPU Job ID ${gpuJobId}`);
        return res.status(500).json({ message: "Unexpected error occurred while processing webhook" });
    }
});

export default router;