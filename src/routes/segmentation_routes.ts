import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startInference, startManualInference } from "../services/inference"; 
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { readProjectSegmentationMask, updateProjectSegmentationMask, updateProject, readProject } from "../services/database";
import { isAuth, isAuthAndAdmin, isAuthAndNotGuest } from "../services/passportjs"; 
import LogError from "../utils/error_logger";
import { jobModel, userModel, JobStatus } from "../services/database";
import { uploadSegMaskToS3 } from "../services/s3_handler";
import { ComponentBoundingBoxesClass, IProjectSegmentationMask } from "../types/database_types"; 

const router = Router();
const serviceLocation = "SegmentationRoutes";

// Route to start inference for a specific project
router.post("/start-segmentation/:projectId",
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
            // Differentiate between "project not found" and other errors
            if (result.message?.includes("does not exist")) {
                logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching segmentation masks.`);
                return res.status(404).json({ message: result.message });
            }
            logger.error(`${serviceLocation}: Error reading segmentation masks for project ${projectId}: ${result.message}`);
            return res.status(500).json({ message: result.message || "Error reading segmentation masks." });
        }

        // Handle case where project exists but has no segmentation masks
        if (!result.projectsegmentationmasks || result.projectsegmentationmasks.length === 0) {
            logger.info(`${serviceLocation}: No segmentation masks found for project ID ${projectId}.`);
            return res.status(200).json({ 
                message: "No segmentation masks found for this project.", 
                segmentations: [] 
            });
        }

        logger.info(`${serviceLocation}: Successfully fetched ${result.projectsegmentationmasks.length} segmentation mask(s) for project ID ${projectId}.`);
        // The frontend will receive an array of IProjectSegmentationMaskDocument objects
        return res.status(200).json({ segmentations: result.projectsegmentationmasks });

    } catch (error) {
        LogError(error as Error, serviceLocation, `Unexpected error fetching segmentation masks for project ${projectId}`);
        return res.status(500).json({ message: "An unexpected error occurred while fetching segmentation masks." });
    }
});

// Route to start MANUAL inference for a specific project and image with a bounding box
router.post("/start-manual-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId: projectIdFromParams } = req.params; // projectId from URL
        // Extract from body, including the new projectIdFromBody
        const { 
            projectId: projectIdFromBody, // projectId from request body
            image_name, 
            bbox, 
            segmentation_source, 
            segmentationName, 
            segmentationDescription 
        } = req.body; 

        // Log if projectId is provided in body and if it matches params
        if (projectIdFromBody) {
            logger.info(`${serviceLocation}: projectId was also provided in the request body: ${projectIdFromBody} for URL projectId: ${projectIdFromParams}`);
            if (projectIdFromBody !== projectIdFromParams) {
                logger.warn(`${serviceLocation}: projectId in URL params (${projectIdFromParams}) and body (${projectIdFromBody}) do not match. Using projectId from URL params for the operation.`);
                // Optionally, you could return an error if they absolutely must match:
                // return res.status(400).json({ success: false, message: "Project ID in URL and body do not match." });
            }
        }

        // Use the projectId from the URL parameters as the definitive one for the operation
        const effectiveProjectId = projectIdFromParams; 

        logger.info(`${serviceLocation}: Received start MANUAL inference request for project ${effectiveProjectId}, image ${image_name} by user ${req.user?.username} with id ${req.user?._id}`);

        // Validate inputs (image_name, bbox, etc.)
        if (!image_name || typeof image_name !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId} is missing or has invalid 'image_name'.`);
            return res.status(400).json({ success: false, message: "Missing or invalid 'image_name' in request body." });
        }
        if (!bbox || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(coord => typeof coord === 'number')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId}, image ${image_name} has invalid 'bbox'.`);
            return res.status(400).json({ success: false, message: "Invalid 'bbox' in request body. Expected an array of 4 numbers." });
        }

        // Validate segmentation_source
        if (segmentation_source && (segmentation_source !== 'ai_inference' && segmentation_source !== 'manual_inference')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId} has invalid 'segmentation_source'. Must be 'ai_inference' or 'manual_inference'. Received: ${segmentation_source}`);
            return res.status(400).json({ success: false, message: "Invalid 'segmentation_source'. Must be 'ai_inference' or 'manual_inference'." });
        }
        if (!segmentation_source) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId} is missing 'segmentation_source'. It must be 'ai_inference' or 'manual_inference'.`);
            return res.status(400).json({ success: false, message: "Missing 'segmentation_source'. It must be 'ai_inference' or 'manual_inference'." });
        }

        if (segmentationName && typeof segmentationName !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId} has invalid 'segmentationName'.`);
            return res.status(400).json({ success: false, message: "Invalid 'segmentationName'. Must be a string." });
        }
        if (segmentationDescription && typeof segmentationDescription !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${effectiveProjectId} has invalid 'segmentationDescription'.`);
            return res.status(400).json({ success: false, message: "Invalid 'segmentationDescription'. Must be a string." });
        }
    
        try {
            const manualInput = { 
                image_name, 
                bbox, 
                segmentation_source,
                segmentationName,
                segmentationDescription
            };
            // Call startManualInference with effectiveProjectId from params
            const result = await startManualInference(effectiveProjectId, req.user as any, res.locals.gpuAuthToken, manualInput);
            
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid }); // Return the UUID to the client
            } else {
                // Use result.message if available, otherwise a generic error
                res.status(500).json({ message: result.message || "Failed to start manual inference." });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, `Error starting manual inference for project ${effectiveProjectId}, image ${image_name}`);
            res.status(500).json({ message: "An unexpected error occurred while starting manual inference." });
        }
    });

router.get("/user-check-jobs", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id;
    
    logger.info(`${serviceLocation}: Fetching all jobs for user ${req.user?.username}`);
    
    try {
        // Find all jobs for this user
        const jobs = await jobModel.find({ 
            userid: userId
        }).sort({ createdAt: -1 }).limit(20); // Increased limit to see more jobs
        
        // Get queue information
        const pendingJobs = await jobModel.find({
            status: JobStatus.PENDING
        }).sort({ createdAt: 1 }); // Sort by oldest first to determine queue position
        
        // Get active job count
        const activeJobCount = await jobModel.countDocuments({
            userid: userId,
            status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] }
        });
        
        return res.status(200).json({
            success: true,
            activeJobCount,
            totalJobs: jobs.length,
            jobs: jobs.map(job => {
                // Calculate queue position for pending jobs
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

// Add this new endpoint for admin access to all jobs
router.get("/admin-check-all-jobs-status", isAuthAndAdmin, async (req: Request, res: Response) => {
    logger.info(`${serviceLocation}: Admin ${req.user?.username} requesting all system jobs`);
    
    try {
        // Get counts by status
        const pendingCount = await jobModel.countDocuments({ status: JobStatus.PENDING });
        const processingCount = await jobModel.countDocuments({ status: JobStatus.IN_PROGRESS });
        const completedCount = await jobModel.countDocuments({ status: JobStatus.COMPLETED });
        const failedCount = await jobModel.countDocuments({ status: JobStatus.FAILED });
        
        // Get latest jobs with pagination
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
        
        // Get jobs with user information
        const jobs = await jobModel.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Get user information for these jobs
        const userIds = [...new Set(jobs.map(job => job.userid))];
        const users = await userModel.find({ _id: { $in: userIds } })
            .select('_id username');
        
        // Create a map for quick user lookups
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

// Route to mark an AI segmentation mask as saved in the database
router.patch("/save-ai-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
      const { segmentationMaskId } = req.body; // Expecting JSON body now
      const userId = (req.user)?._id;

      logger.info(`${serviceLocation}: Received request to mark AI segmentation mask ${segmentationMaskId} as saved by user ${userId}.`);

      // Validate request
      if (!userId) {
        logger.warn(`${serviceLocation}: Unauthorized attempt to save AI segmentation. User ID not found.`);
        return res.status(401).json({
          success: false,
          message: "Unauthorized. User ID not found."
        });
      }

      if (!segmentationMaskId) {
        logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving AI segmentation.`);
        return res.status(400).json({
          success: false,
          message: "Missing segmentationMaskId."
        });
      }

      // Get the segmentation mask to verify it exists and get its project ID
      const maskResult = await readProjectSegmentationMask(segmentationMaskId);

      if (!maskResult.success || !maskResult.projectsegmentationmask) {
        logger.warn(`${serviceLocation}: AI Segmentation mask ${segmentationMaskId} not found. Message: ${maskResult.message}`);
        return res.status(404).json({
          success: false,
          message: maskResult.message || "Segmentation mask not found."
        });
      }

      const projectId = maskResult.projectsegmentationmask.projectid;

      // Update segmentation mask to isSaved: true in the database
      logger.debug(`${serviceLocation}: Updating AI segmentation mask ${segmentationMaskId} to isSaved: true.`);
      const segmentationDbUpdateResult = await updateProjectSegmentationMask(
        segmentationMaskId,
        { isSaved: true }
      );

      if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
        logger.error(`${serviceLocation}: Failed to update AI segmentation mask ${segmentationMaskId} status in database. Message: ${segmentationDbUpdateResult.message}`);
        return res.status(400).json({
          success: false,
          message: segmentationDbUpdateResult.message || "Failed to update segmentation mask status in database."
        });
      }
      logger.info(`${serviceLocation}: Successfully updated AI segmentation mask ${segmentationMaskId} to isSaved: true in DB.`);

      // Check if the parent project is already saved before updating it
      logger.debug(`${serviceLocation}: Checking save status of parent project ${projectId} for AI segmentation mask ${segmentationMaskId}.`);
      const projectResult = await readProject(projectId, userId.toString()); // Ensure userId is string

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
      LogError(
        error instanceof Error ? error : new Error(errorMessage),
        serviceLocation,
        `Error marking AI segmentation mask as saved: ${segmentationMaskIdBody}`
      );
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred while saving the AI segmentation."
      });
    }
  }
);

// Route to update RLE for a MANUAL segmentation mask and mark as saved
router.patch("/save-manual-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
    const { 
        segmentationMaskId, 
        frameIndex: frameIndexStr, // Will be string from form-data or JSON
        sliceIndex: sliceIndexStr, // Will be string from form-data or JSON
        componentClass, 
        rleString 
    } = req.body; 
    const userId = (req.user)?._id;

    logger.info(`${serviceLocation}: Received request to save manual segmentation (RLE update) for mask ID ${segmentationMaskId} by user ${userId}. Slice: F${frameIndexStr}S${sliceIndexStr}, Class: ${componentClass}`);

    // Validate request
    if (!userId) {
      logger.warn(`${serviceLocation}: Unauthorized attempt to save manual segmentation. User ID not found.`);
      return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
    }
    if (!segmentationMaskId) {
      logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving manual segmentation.`);
      return res.status(400).json({ success: false, message: "Missing segmentationMaskId." });
    }

    // Validate RLE update parameters
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
    // Ensure componentClass is a valid enum value
    if (!Object.values(ComponentBoundingBoxesClass).includes(componentClass as ComponentBoundingBoxesClass)) {
        logger.warn(`${serviceLocation}: Invalid componentClass '${componentClass}' for mask ${segmentationMaskId}.`);
        return res.status(400).json({ success: false, message: `Invalid componentClass. Must be one of: ${Object.values(ComponentBoundingBoxesClass).join(', ')}` });
    }
    if (typeof rleString !== 'string' || rleString.trim() === "") { // Also check if rleString is empty after trimming
        logger.warn(`${serviceLocation}: Invalid rleString for mask ${segmentationMaskId}. Must be a non-empty string.`);
        return res.status(400).json({ success: false, message: "rleString must be a non-empty string." });
    }

    // Get the segmentation mask to find its project ID and verify it's a manual segmentation
    logger.debug(`${serviceLocation}: Reading segmentation mask ${segmentationMaskId} to verify type and get project ID.`);
    const maskResult = await readProjectSegmentationMask(segmentationMaskId);

    if (!maskResult.success || !maskResult.projectsegmentationmask) {
      logger.warn(`${serviceLocation}: Segmentation mask ${segmentationMaskId} not found for saving manual RLE. Message: ${maskResult.message}`);
      return res.status(404).json({
        success: false,
        message: maskResult.message || "Segmentation mask not found."
      });
    }

    // Ensure this is indeed a manual segmentation mask (isMedSAMOutput should be false)
    if (maskResult.projectsegmentationmask.isMedSAMOutput) {
      logger.warn(`${serviceLocation}: Attempt to save RLE for AI segmentation mask ${segmentationMaskId} via manual route. User: ${userId}`);
      return res.status(400).json({
        success: false,
        message: "This endpoint is for saving manual segmentations. The provided mask ID corresponds to an AI-generated segmentation."
      });
    }

    const projectId = maskResult.projectsegmentationmask.projectid;
    logger.info(`${serviceLocation}: Segmentation mask ${segmentationMaskId} (manual) belongs to project ${projectId}. Proceeding with RLE update.`);

    // Prepare update payload for RLE and isSaved status
    let rleActuallyModified = false; // Flag to track if RLE was indeed changed or added
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
                                sliceModified = true;
                                frameModified = true;
                                rleActuallyModified = true;
                                return { ...sm, segmentationmaskcontents: rleString };
                            }
                        }
                        return sm;
                    });

                    if (!componentFoundAndUpdated) {
                        currentSegmentationMasks.push({ class: componentClass as ComponentBoundingBoxesClass, segmentationmaskcontents: rleString });
                        sliceModified = true;
                        frameModified = true;
                        rleActuallyModified = true;
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
    
    const updatePayload: any = { 
        isSaved: true,
    };
    if (rleActuallyModified) { 
        updatePayload.frames = updatedFrames;
    }

    logger.debug(`${serviceLocation}: Updating manual segmentation mask ${segmentationMaskId} with RLE (if changed) and isSaved: true.`);
    const segmentationDbUpdateResult = await updateProjectSegmentationMask(
      segmentationMaskId,
      updatePayload 
    );

    if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
      logger.error(`${serviceLocation}: Failed to update manual segmentation mask ${segmentationMaskId} in database. Message: ${segmentationDbUpdateResult.message}`);
      return res.status(400).json({
        success: false,
        message: segmentationDbUpdateResult.message || "Failed to update segmentation mask in database."
      });
    }
    logger.info(`${serviceLocation}: Successfully updated manual segmentation mask ${segmentationMaskId} (RLE & status) in DB.`);

    // Check if the parent project is already saved before updating it
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
      message: "Manual segmentation RLE updated and saved successfully.", // Adjusted message
      // s3ImageUrl: s3ImageUrl, // REMOVED
      segmentation: segmentationDbUpdateResult.projectsegmentationmask 
    });

  } catch (error) {
    const segmentationMaskIdBody = req.body?.segmentationMaskId || "unknown"; 
    const errorMessage = error instanceof Error ? error.message : String(error);
    LogError(
      error instanceof Error ? error : new Error(errorMessage),
      serviceLocation,
      `Error saving manual segmentation (RLE update) for mask ID: ${segmentationMaskIdBody}`
    );
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while saving the manual segmentation."
    });
  }
});

export default router;