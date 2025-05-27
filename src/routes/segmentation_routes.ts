import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startInference } from "../services/inference";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { readProjectSegmentationMask, updateProjectSegmentationMask, updateProject, readProject, jobModel, userModel, JobStatus } from "../services/database";
import { isAuth, isAuthAndAdmin, isAuthAndNotGuest } from "../services/passportjs";
import LogError from "../utils/error_logger";
import { ComponentBoundingBoxesClass, IProjectSegmentationMask } from "../types/database_types";

import axios from 'axios'; // Simplified Axios import
import { v4 as uuidv4 } from 'uuid';
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { extractS3KeyFromUrl } from "../services/s3_handler";

const router = Router();
const serviceLocation = "SegmentationRoutes";

// Define an interface for the expected GPU server response
interface GpuManualInferenceResponse {
    uuid: string;
    status: string;
    result?: {
        [imageName: string]: {
            boxes: Array<{
                bbox: number[];
                confidence?: number;
                class_id?: number;
                class_name?: string;
            }>;
            masks: {
                [className: string]: string;
            };
        };
    };
    error?: string | null;
    message?: string; // Some APIs might use 'message' for errors in the body
}


// Route to start inference for a specific project (Unchanged)
router.post("/start-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId } = req.params;
        logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
        try {
            const result = await startInference(projectId, req.user, res.locals.gpuAuthToken);
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid });
            } else {
                res.status(500).json({ message: result.message });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting inference");
            if (!res.headersSent) {
                res.status(500).json({ message: "An unexpected error occurred while starting inference." });
            }
        }
    });

// Route to get segmentation results for a project (Unchanged)
router.get("/segmentation-results/:projectId", isAuth, async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
        logger.warn(`${serviceLocation}: Project ID is required to fetch segmentation masks.`);
        return res.status(400).json({ message: "Project ID is required." });
    }
    logger.info(`${serviceLocation}: Received request to fetch segmentation masks for project ID: ${projectId}`);
    try {
        const result = await readProjectSegmentationMask(projectId);
        if (!result.success) {
            if (result.message?.includes("does not exist")) {
                logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching segmentation masks.`);
                return res.status(404).json({ message: result.message });
            }
            logger.error(`${serviceLocation}: Error reading segmentation masks for project ${projectId}: ${result.message}`);
            return res.status(500).json({ message: result.message || "Error reading segmentation masks." });
        }
        if (!result.projectsegmentationmasks || result.projectsegmentationmasks.length === 0) {
            logger.info(`${serviceLocation}: No segmentation masks found for project ID ${projectId}.`);
            return res.status(200).json({
                message: "No segmentation masks found for this project.",
                segmentations: []
            });
        }
        logger.info(`${serviceLocation}: Successfully fetched ${result.projectsegmentationmasks.length} segmentation mask(s) for project ID ${projectId}.`);
        return res.status(200).json({ segmentations: result.projectsegmentationmasks });
    } catch (error) {
        LogError(error as Error, serviceLocation, `Unexpected error fetching segmentation masks for project ${projectId}`);
        return res.status(500).json({ message: "An unexpected error occurred while fetching segmentation masks." });
    }
});

// NEW Route to start MANUAL segmentation (Corrected Axios Error Handling)
router.post("/start-manual-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId } = req.params;
        const userId = (req.user as any)?._id;
        const {
            image_name,
            bbox,
            segmentationName,
            segmentationDescription
        } = req.body;

        logger.info(`${serviceLocation}: Received new start MANUAL segmentation request for project ${projectId}, image ${image_name} by user ${req.user?.username} with id ${userId}`);

        if (!image_name || typeof image_name !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} is missing or has invalid 'image_name'.`);
            return res.status(400).json({ success: false, message: "Missing or invalid 'image_name' in request body." });
        }
        if (!bbox || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(coord => typeof coord === 'number')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId}, image ${image_name} has invalid 'bbox'.`);
            return res.status(400).json({ success: false, message: "Invalid 'bbox' in request body. Expected an array of 4 numbers." });
        }
        if (!userId) {
            logger.warn(`${serviceLocation}: Unauthorized manual segmentation request for project ${projectId}. User not found.`);
            return res.status(401).json({ success: false, message: "Unauthorized. User not identified." });
        }

        try {
            logger.debug(`${serviceLocation}: Fetching project details for ${projectId} to get S3 URL.`);
            const projectResult = await readProject(projectId, userId.toString());
            if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
                logger.warn(`${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access.`);
                return res.status(404).json({ success: false, message: "Project not found or access denied." });
            }
            const project = projectResult.projects[0];
            const s3HttpsUrlForTar = project.extractedfolderpath;
            if (!s3HttpsUrlForTar) {
                logger.warn(`${serviceLocation}: Project ${projectId} has no associated S3 file (extractedfolderpath missing).`);
                return res.status(404).json({ success: false, message: "Project has no associated file for segmentation." });
            }
            const objectKey = extractS3KeyFromUrl(s3HttpsUrlForTar);
            if (!objectKey) {
                logger.error(`${serviceLocation}: Invalid S3 URL format for project ${projectId}: ${s3HttpsUrlForTar}`);
                return res.status(500).json({ success: false, message: "Internal error: Invalid S3 URL format." });
            }
            const awsBucketName = process.env.AWS_BUCKET_NAME;
            if (!awsBucketName) {
                logger.error(`${serviceLocation}: AWS_BUCKET_NAME environment variable is not set.`);
                return res.status(500).json({ success: false, message: "Server configuration error: AWS bucket name missing." });
            }
            const presignedUrl = await generatePresignedGetUrl(awsBucketName, objectKey, 1800);
            if (!presignedUrl) {
                logger.error(`${serviceLocation}: Failed to generate presigned URL for project ${projectId}, object ${objectKey}.`);
                return res.status(500).json({ success: false, message: "Failed to generate presigned URL." });
            }
            logger.info(`${serviceLocation}: Generated presigned URL for project ${projectId}.`);

            const gpuRequestId = uuidv4();
            const gpuHost = process.env.GPU_SERVER_URL;
            const gpuPort = process.env.GPU_SERVER_PORT;
            if (!gpuHost || !gpuPort) {
                logger.error(`${serviceLocation}: GPU_SERVER_URL or GPU_SERVER_PORT environment variables are not set.`);
                return res.status(500).json({ success: false, message: "Server configuration error: GPU server details missing." });
            }
            const gpuServerUrl = `http://${gpuHost}:${gpuPort}/inference/v2/medsam-inference-manual`;
            logger.info(`${serviceLocation}: Sending request to GPU server ${gpuServerUrl} for image ${image_name} with UUID ${gpuRequestId}.`);
            const gpuServerPayload = { url: presignedUrl, uuid: gpuRequestId, image_name: image_name, bbox: bbox };

            const gpuResponse = await axios.post<GpuManualInferenceResponse>(gpuServerUrl, gpuServerPayload, { 
                headers: {
                    'Authorization': `Bearer ${res.locals.gpuAuthToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000 
            });

            logger.info(`${serviceLocation}: Received response from GPU server for UUID ${gpuResponse.data.uuid}, status ${gpuResponse.data.status}.`);

            if (gpuResponse.data.status !== "completed" || !gpuResponse.data.result) {
                const gpuErrorMsg = gpuResponse.data.error || gpuResponse.data.message || "Unknown GPU error";
                logger.error(`${serviceLocation}: GPU server returned status ${gpuResponse.data.status} or no result. Error: ${gpuErrorMsg}`);
                return res.status(500).json({ success: false, message: `GPU processing failed: ${gpuErrorMsg}` });
            }

            const gpuResultForImage = gpuResponse.data.result[image_name];
            if (!gpuResultForImage) {
                logger.error(`${serviceLocation}: GPU server response did not contain results for the requested image_name ${image_name}. Result keys: ${Object.keys(gpuResponse.data.result || {})}`);
                return res.status(500).json({ success: false, message: "GPU server response missing data for the image." });
            }

            let frameIndex = 0;
            let sliceIndex = 0;
            try {
                const nameParts = image_name.split('.')[0].split('_');
                if (nameParts.length >= 2) {
                    sliceIndex = parseInt(nameParts[nameParts.length - 1], 10);
                    frameIndex = parseInt(nameParts[nameParts.length - 2], 10);
                    if (isNaN(sliceIndex) || isNaN(frameIndex)) {
                        logger.warn(`${serviceLocation}: Could not parse valid frame/slice indices from ${image_name}. Defaulting to 0,0.`);
                        sliceIndex = 0; frameIndex = 0;
                    }
                } else {
                     logger.warn(`${serviceLocation}: image_name ${image_name} format not parsable for frame/slice. Defaulting to 0,0.`);
                }
            } catch (parseError) {
                logger.warn(`${serviceLocation}: Error parsing frame/slice from ${image_name}. Defaulting to 0,0. Error: ${parseError}`);
                sliceIndex = 0; frameIndex = 0;
            }

            const componentBoundingBoxes = gpuResultForImage.boxes.map(box => ({
                class: box.class_name === "manual" ? ComponentBoundingBoxesClass.MANUAL : (box.class_name as ComponentBoundingBoxesClass),
                confidence: box.confidence !== undefined ? box.confidence : 1,
                x_min: box.bbox[0],
                y_min: box.bbox[1],
                x_max: box.bbox[2],
                y_max: box.bbox[3]
            }));

            const segmentationMasks = Object.entries(gpuResultForImage.masks).map(([className, rleString]) => ({
                class: className === "manual" ? ComponentBoundingBoxesClass.MANUAL : (className as ComponentBoundingBoxesClass),
                segmentationmaskcontents: rleString
            }));

            const transformedSegmentationId = uuidv4();
            const transformedSegmentation: IProjectSegmentationMask = {
                _id: transformedSegmentationId,
                projectid: projectId,
                name: segmentationName || `Manual Segmentation - ${image_name}`,
                description: segmentationDescription || `Manually segmented region for ${image_name} using bbox: ${JSON.stringify(bbox)}`,
                isSaved: false,
                segmentationmaskRLE: true,
                isMedSAMOutput: false,
                frames: [{
                    frameindex: frameIndex,
                    frameinferred: true,
                    slices: [{
                        sliceindex: sliceIndex,
                        componentboundingboxes: componentBoundingBoxes,
                        segmentationmasks: segmentationMasks
                    }]
                }]
            };

            logger.info(`${serviceLocation}: Successfully transformed GPU result for project ${projectId}, image ${image_name}.`);
            res.status(200).json({ segmentations: [transformedSegmentation] });

        } catch (error: unknown) {
            LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, `Error in new start-manual-segmentation for project ${projectId}, image ${image_name}`);
            let errorMessage = "An unexpected error occurred while processing manual segmentation.";

            if (axios.isAxiosError(error)) { // This is the standard type guard
                // Inside this block, TypeScript knows 'error' is an AxiosError
                if (error.response) {
                    // Access data from error.response.data, which might be GpuManualInferenceResponse or another error structure
                    const responseData = error.response.data as Partial<GpuManualInferenceResponse>; // Cast to allow optional fields
                    errorMessage = responseData?.error || responseData?.message || error.message || "Error from GPU server.";
                    logger.error(
                        `${serviceLocation}: Axios error - ${errorMessage}, ` +
                        `Status: ${error.response.status}, ` +
                        `Response Data: ${JSON.stringify(error.response.data)}`
                    );
                } else if (error.request) {
                    // The request was made but no response was received
                    errorMessage = `No response received from GPU server: ${error.message}`;
                    logger.error(`${serviceLocation}: Axios error - ${errorMessage} (no response). Request details might be in error.config.`);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    errorMessage = `Error setting up request to GPU server: ${error.message}`;
                    logger.error(`${serviceLocation}: Axios error - ${errorMessage} (request setup).`);
                }
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            if (!res.headersSent) {
                res.status(500).json({ success: false, message: errorMessage });
            }
        }
    });

// (The rest of your routes: /user-check-jobs, /admin-check-all-jobs-status, /save-ai-segmentation, /save-manual-segmentation remain unchanged)
// ...
// Route to check user's jobs (Unchanged)
router.get("/user-check-jobs", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id;
    logger.info(`${serviceLocation}: Fetching all jobs for user ${req.user?.username}`);
    try {
        const jobs = await jobModel.find({ userid: userId }).sort({ createdAt: -1 }).limit(20);
        const pendingJobs = await jobModel.find({ status: JobStatus.PENDING }).sort({ createdAt: 1 });
        const activeJobCount = await jobModel.countDocuments({
            userid: userId,
            status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] }
        });
        return res.status(200).json({
            success: true,
            activeJobCount,
            totalJobs: jobs.length,
            jobs: jobs.map(job => {
                let queuePosition = null;
                if (job.status === JobStatus.PENDING) {
                    queuePosition = pendingJobs.findIndex(j => j.uuid === job.uuid) + 1;
                }
                return {
                    jobId: job.uuid,
                    projectId: job.projectid,
                    status: job.status,
                    queuePosition: queuePosition
                };
            })
        });
    } catch (error: any) {
        LogError(error as Error, serviceLocation, `Error fetching jobs for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching jobs"
        });
    }
});

// Route for admin access to all jobs (Unchanged)
router.get("/admin-check-all-jobs-status", isAuthAndAdmin, async (req: Request, res: Response) => {
    logger.info(`${serviceLocation}: Admin ${req.user?.username} requesting all system jobs`);
    try {
        const pendingCount = await jobModel.countDocuments({ status: JobStatus.PENDING });
        const processingCount = await jobModel.countDocuments({ status: JobStatus.IN_PROGRESS });
        const completedCount = await jobModel.countDocuments({ status: JobStatus.COMPLETED });
        const failedCount = await jobModel.countDocuments({ status: JobStatus.FAILED });
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
        const jobs = await jobModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
        const userIds = [...new Set(jobs.map(job => job.userid))];
        const users = await userModel.find({ _id: { $in: userIds } }).select('_id username');
        const userMap: { [key: string]: string } = {};
        users.forEach(user => {
            userMap[String(user._id)] = user.username;
        });
        return res.status(200).json({
            success: true,
            stats: {
                total: pendingCount + processingCount + completedCount + failedCount,
                pending: pendingCount,
                processing: processingCount,
                completed: completedCount,
                failed: failedCount
            },
            pagination: {
                page,
                limit,
                totalPages: Math.ceil((pendingCount + processingCount + completedCount + failedCount) / limit)
            },
            jobs: jobs.map(job => ({
                jobId: job.uuid,
                projectId: job.projectid,
                userId: job.userid,
                username: userMap[job.userid] || 'Unknown',
                status: job.status,
                message: job.message || ""
            }))
        });
    } catch (error: any) {
        LogError(error as Error, serviceLocation, `Admin error fetching all jobs: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching all jobs"
        });
    }
});

// Route to mark an AI segmentation mask as saved (Unchanged)
router.patch("/save-ai-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
      const { segmentationMaskId } = req.body;
      const userId = (req.user)?._id;
      logger.info(`${serviceLocation}: Received request to mark AI segmentation mask ${segmentationMaskId} as saved by user ${userId}.`);
      if (!userId) {
        logger.warn(`${serviceLocation}: Unauthorized attempt to save AI segmentation. User ID not found.`);
        return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
      }
      if (!segmentationMaskId) {
        logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving AI segmentation.`);
        return res.status(400).json({ success: false, message: "Missing segmentationMaskId." });
      }
      const maskResult = await readProjectSegmentationMask(segmentationMaskId);
      if (!maskResult.success || !maskResult.projectsegmentationmask) {
        logger.warn(`${serviceLocation}: AI Segmentation mask ${segmentationMaskId} not found. Message: ${maskResult.message}`);
        return res.status(404).json({ success: false, message: maskResult.message || "Segmentation mask not found." });
      }
      const projectId = maskResult.projectsegmentationmask.projectid;
      logger.debug(`${serviceLocation}: Updating AI segmentation mask ${segmentationMaskId} to isSaved: true.`);
      const segmentationDbUpdateResult = await updateProjectSegmentationMask(segmentationMaskId, { isSaved: true });
      if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
        logger.error(`${serviceLocation}: Failed to update AI segmentation mask ${segmentationMaskId} status in database. Message: ${segmentationDbUpdateResult.message}`);
        return res.status(400).json({ success: false, message: segmentationDbUpdateResult.message || "Failed to update segmentation mask status in database." });
      }
      logger.info(`${serviceLocation}: Successfully updated AI segmentation mask ${segmentationMaskId} to isSaved: true in DB.`);
      logger.debug(`${serviceLocation}: Checking save status of parent project ${projectId} for AI segmentation mask ${segmentationMaskId}.`);
      const projectResult = await readProject(projectId, userId.toString());
      if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
        logger.warn(`${serviceLocation}: Could not find project ${projectId} to check/update save status after saving AI segmentation mask ${segmentationMaskId}.`);
      } else {
        const project = projectResult.projects[0];
        if (!project.isSaved) {
          logger.info(`${serviceLocation}: Parent project ${projectId} is not saved. Updating its status to saved.`);
          const updateProjectResult = await updateProject(projectId, { isSaved: true });
          if (!updateProjectResult.success) {
            logger.warn(`${serviceLocation}: Failed to update project ${projectId} save status. Message: ${updateProjectResult.message}`);
          } else {
            logger.info(`${serviceLocation}: Parent project ${projectId} save status successfully updated to true.`);
          }
        } else {
          logger.info(`${serviceLocation}: Parent project ${projectId} was already saved.`);
        }
      }
      logger.info(`${serviceLocation}: User ${userId} successfully marked AI segmentation mask ${segmentationMaskId} as saved. DB status updated.`);
      return res.status(200).json({
        success: true,
        message: "AI Segmentation mask marked as saved successfully.",
        segmentation: segmentationDbUpdateResult.projectsegmentationmask
      });
    } catch (error) {
      const segmentationMaskIdBody = req.body?.segmentationMaskId || "unknown";
      const errorMessage = error instanceof Error ? error.message : String(error);
      LogError(error instanceof Error ? error : new Error(errorMessage), serviceLocation, `Error marking AI segmentation mask as saved: ${segmentationMaskIdBody}`);
      return res.status(500).json({ success: false, message: "An unexpected error occurred while saving the AI segmentation." });
    }
  }
);

// Route to update RLE for a MANUAL segmentation mask and mark as saved (Unchanged)
router.patch("/save-manual-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
    const { segmentationMaskId, frameIndex: frameIndexStr, sliceIndex: sliceIndexStr, componentClass, rleString } = req.body;
    const userId = (req.user)?._id;
    logger.info(`${serviceLocation}: Received request to save manual segmentation (RLE update) for mask ID ${segmentationMaskId} by user ${userId}. Slice: F${frameIndexStr}S${sliceIndexStr}, Class: ${componentClass}`);
    if (!userId) {
      logger.warn(`${serviceLocation}: Unauthorized attempt to save manual segmentation. User ID not found.`);
      return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
    }
    if (!segmentationMaskId) {
      logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving manual segmentation.`);
      return res.status(400).json({ success: false, message: "Missing segmentationMaskId." });
    }
    if (frameIndexStr === undefined || sliceIndexStr === undefined || !componentClass || !rleString) {
        logger.warn(`${serviceLocation}: Missing RLE update parameters for mask ${segmentationMaskId}. Required: frameIndex, sliceIndex, componentClass, rleString.`);
        return res.status(400).json({ success: false, message: "Missing RLE update parameters (frameIndex, sliceIndex, componentClass, rleString)." });
    }
    const frameIndex = parseInt(frameIndexStr, 10);
    const sliceIndex = parseInt(sliceIndexStr, 10);
    if (isNaN(frameIndex) || isNaN(sliceIndex) || frameIndex < 0 || sliceIndex < 0) {
        logger.warn(`${serviceLocation}: Invalid frameIndex or sliceIndex for mask ${segmentationMaskId}. Received F:${frameIndexStr}, S:${sliceIndexStr}`);
        return res.status(400).json({ success: false, message: "Invalid frameIndex or sliceIndex. Must be non-negative numbers." });
    }
    if (!Object.values(ComponentBoundingBoxesClass).includes(componentClass as ComponentBoundingBoxesClass)) {
        logger.warn(`${serviceLocation}: Invalid componentClass '${componentClass}' for mask ${segmentationMaskId}.`);
        return res.status(400).json({ success: false, message: `Invalid componentClass. Must be one of: ${Object.values(ComponentBoundingBoxesClass).join(', ')}` });
    }
    if (typeof rleString !== 'string' || rleString.trim() === "") {
        logger.warn(`${serviceLocation}: Invalid rleString for mask ${segmentationMaskId}. Must be a non-empty string.`);
        return res.status(400).json({ success: false, message: "rleString must be a non-empty string." });
    }
    logger.debug(`${serviceLocation}: Reading segmentation mask ${segmentationMaskId} to verify type and get project ID.`);
    const maskResult = await readProjectSegmentationMask(segmentationMaskId);
    if (!maskResult.success || !maskResult.projectsegmentationmask) {
      logger.warn(`${serviceLocation}: Segmentation mask ${segmentationMaskId} not found for saving manual RLE. Message: ${maskResult.message}`);
      return res.status(404).json({ success: false, message: maskResult.message || "Segmentation mask not found." });
    }
    if (maskResult.projectsegmentationmask.isMedSAMOutput) {
      logger.warn(`${serviceLocation}: Attempt to save RLE for AI segmentation mask ${segmentationMaskId} via manual route. User: ${userId}`);
      return res.status(400).json({ success: false, message: "This endpoint is for saving manual segmentations. The provided mask ID corresponds to an AI-generated segmentation." });
    }
    const projectId = maskResult.projectsegmentationmask.projectid;
    logger.info(`${serviceLocation}: Segmentation mask ${segmentationMaskId} (manual) belongs to project ${projectId}. Proceeding with RLE update.`);
    let rleActuallyModified = false;
    const updatedFrames = maskResult.projectsegmentationmask.frames.map(f => {
        if (f.frameindex === frameIndex) {
            let frameModified = false;
            const updatedSlices = f.slices.map(s => {
                if (s.sliceindex === sliceIndex) {
                    let sliceModified = false;
                    let componentFoundAndUpdated = false;
                    let currentSegmentationMasks = s.segmentationmasks ? [...s.segmentationmasks] : [];
                    currentSegmentationMasks = currentSegmentationMasks.map(sm => {
                        if (sm.class === componentClass) {
                            componentFoundAndUpdated = true;
                            if (sm.segmentationmaskcontents !== rleString) {
                                sliceModified = true; frameModified = true; rleActuallyModified = true;
                                return { ...sm, segmentationmaskcontents: rleString };
                            }
                        }
                        return sm;
                    });
                    if (!componentFoundAndUpdated) {
                        currentSegmentationMasks.push({ class: componentClass as ComponentBoundingBoxesClass, segmentationmaskcontents: rleString });
                        sliceModified = true; frameModified = true; rleActuallyModified = true;
                    }
                    return sliceModified ? { ...s, segmentationmasks: currentSegmentationMasks } : s;
                }
                return s;
            });
            return frameModified ? { ...f, slices: updatedSlices } : f;
        }
        return f;
    });
    if (!rleActuallyModified) {
        logger.info(`${serviceLocation}: RLE for mask ${segmentationMaskId}, F${frameIndex}S${sliceIndex}, Class ${componentClass} was not modified or added. Proceeding with save status update.`);
    }
    const updatePayload: any = { isSaved: true };
    if (rleActuallyModified) { updatePayload.frames = updatedFrames; }
    logger.debug(`${serviceLocation}: Updating manual segmentation mask ${segmentationMaskId} with RLE (if changed) and isSaved: true.`);
    const segmentationDbUpdateResult = await updateProjectSegmentationMask(segmentationMaskId, updatePayload);
    if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
      logger.error(`${serviceLocation}: Failed to update manual segmentation mask ${segmentationMaskId} in database. Message: ${segmentationDbUpdateResult.message}`);
      return res.status(400).json({ success: false, message: segmentationDbUpdateResult.message || "Failed to update segmentation mask in database." });
    }
    logger.info(`${serviceLocation}: Successfully updated manual segmentation mask ${segmentationMaskId} (RLE & status) in DB.`);
    logger.debug(`${serviceLocation}: Checking save status of parent project ${projectId} for manual segmentation mask ${segmentationMaskId}.`);
    const projectResult = await readProject(projectId, userId.toString());
    if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
      logger.warn(`${serviceLocation}: Could not find project ${projectId} to check/update save status after saving manual segmentation mask ${segmentationMaskId}.`);
    } else {
      const project = projectResult.projects[0];
      if (!project.isSaved) {
        logger.info(`${serviceLocation}: Parent project ${projectId} is not saved. Updating its status to saved.`);
        const updateProjectResult = await updateProject(projectId, { isSaved: true });
        if (!updateProjectResult.success) {
          logger.warn(`${serviceLocation}: Failed to update project ${projectId} save status after manual segmentation save. Message: ${updateProjectResult.message}`);
        } else {
          logger.info(`${serviceLocation}: Parent project ${projectId} save status successfully updated to true.`);
        }
      } else {
        logger.info(`${serviceLocation}: Parent project ${projectId} was already saved.`);
      }
    }
    logger.info(`${serviceLocation}: User ${userId} successfully processed save request for manual segmentation (RLE update) for mask ${segmentationMaskId}. DB status updated.`);
    return res.status(200).json({
      success: true,
      message: "Manual segmentation RLE updated and saved successfully.",
      segmentation: segmentationDbUpdateResult.projectsegmentationmask
    });
  } catch (error) {
    const segmentationMaskIdBody = req.body?.segmentationMaskId || "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    LogError(error instanceof Error ? error : new Error(errorMessage), serviceLocation, `Error saving manual segmentation (RLE update) for mask ID: ${segmentationMaskIdBody}`);
    return res.status(500).json({ success: false, message: "An unexpected error occurred while saving the manual segmentation." });
  }
});

export default router;