import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startInference, startManualInference } from "../services/inference"; 
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { readProjectSegmentationMask, updateProjectSegmentationMask, updateProject, readProject } from "../services/database";
import { isAuth, isAuthAndAdmin, isAuthAndNotGuest } from "../services/passportjs"; 
import LogError from "../utils/error_logger";
import { jobModel, userModel, JobStatus } from "../services/database";
import { uploadSegMaskToS3 } from "../services/s3_handler";
import { ComponentBoundingBoxesClass} from "../types/database_types"; 

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
        const { projectId } = req.params;
        // Extract image_name, bbox, segmentation_source, segmentationName, and segmentationDescription
        const { image_name, bbox, segmentation_source, segmentationName, segmentationDescription } = req.body; 

        logger.info(`${serviceLocation}: Received start MANUAL inference request for project ${projectId}, image ${image_name} by user ${req.user?.username} with id ${req.user?._id}`);

        // Validate inputs
        if (!image_name || typeof image_name !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} is missing or has invalid 'image_name'.`);
            return res.status(400).json({ message: "Missing or invalid 'image_name' in request body." });
        }
        if (!bbox || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(coord => typeof coord === 'number')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId}, image ${image_name} has invalid 'bbox'.`);
            return res.status(400).json({ message: "Invalid 'bbox' in request body. Expected an array of 4 numbers." });
        }

        // Validate segmentation_source
        if (segmentation_source && (segmentation_source !== 'ai_inference' && segmentation_source !== 'manual_inference')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} has invalid 'segmentation_source'. Must be 'ai_inference' or 'manual_inference'. Received: ${segmentation_source}`);
            return res.status(400).json({ message: "Invalid 'segmentation_source'. Must be 'ai_inference' or 'manual_inference'." });
        }
        // Ensure segmentation_source is provided if it's a manual inference that needs distinction
        if (!segmentation_source) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} is missing 'segmentation_source'. It must be 'ai_inference' or 'manual_inference'.`);
            return res.status(400).json({ message: "Missing 'segmentation_source'. It must be 'ai_inference' or 'manual_inference'." });
        }

        // Validate segmentationName and segmentationDescription if needed (e.g., length)
        if (segmentationName && typeof segmentationName !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} has invalid 'segmentationName'.`);
            return res.status(400).json({ message: "Invalid 'segmentationName'. Must be a string." });
        }
        if (segmentationDescription && typeof segmentationDescription !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} has invalid 'segmentationDescription'.`);
            return res.status(400).json({ message: "Invalid 'segmentationDescription'. Must be a string." });
        }
    
        try {
            const manualInput = { 
                image_name, 
                bbox, 
                segmentation_source,
                segmentationName,      // Pass to service
                segmentationDescription // Pass to service
            };
            const result = await startManualInference(projectId, req.user as any, res.locals.gpuAuthToken, manualInput);
            
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid }); // Return the UUID to the client
            } else {
                res.status(500).json({ message: result.message });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, `Error starting manual inference for project ${projectId}, image ${image_name}`);
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

router.patch("/save-ai-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
      // segmentationMaskId will now come from form-data, not JSON body
      const { segmentationMaskId } = req.body;
      const userId = (req.user)?._id;
      const uploadedFile = req.file; // The uploaded JPEG file

      // Validate request
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. User ID not found."
        });
      }

      if (!segmentationMaskId) {
        return res.status(400).json({
          success: false,
          message: "Missing segmentationMaskId."
        });
      }

      if (!uploadedFile) {
        return res.status(400).json({
          success: false,
          message: "Missing segmentationImage file."
        });
      }

      // Validate file type (optional but recommended)
      if (uploadedFile.mimetype !== 'image/jpeg') {
        return res.status(400).json({
          success: false,
          message: "Invalid file type. Only JPEG images are allowed."
        });
      }

      // First get the segmentation mask to find its project ID
      const maskResult = await readProjectSegmentationMask(segmentationMaskId);

      if (!maskResult.success || !maskResult.projectsegmentationmask) {
        return res.status(404).json({
          success: false,
          message: maskResult.message || "Segmentation mask not found (for associating project)"
        });
      }

      const projectId = maskResult.projectsegmentationmask.projectid;

      // Update segmentation mask to saved status in the database
      const segmentationDbUpdateResult = await updateProjectSegmentationMask(
        segmentationMaskId,
        { isSaved: true } // You might want to store the S3 key of the JPEG here too
      );

      if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
        return res.status(400).json({
          success: false,
          message: segmentationDbUpdateResult.message || "Failed to update segmentation mask status in database"
        });
      }

      // Save the uploaded JPEG to S3
      let s3ImageUrl = '';
      try {
        // Define a new S3 key structure for images
        const s3Key = `seg_mask/${projectId}/${segmentationMaskId}-${Date.now()}.jpeg`;
        if (!process.env.S3_BUCKET_NAME) {
          logger.error(`${serviceLocation}: S3_BUCKET_NAME environment variable is not set. Cannot upload image.`);
          // Decide if this is a critical error
        } else {
          await uploadSegMaskToS3(
            process.env.S3_BUCKET_NAME,
            s3Key,
            uploadedFile.buffer, // Pass the file buffer from multer
            uploadedFile.mimetype // Pass the correct content type
          );
          s3ImageUrl = `s3://${process.env.S3_BUCKET_NAME}/${s3Key}`; // Store or return this URL
          logger.info(`${serviceLocation}: Successfully uploaded segmentation JPEG ${s3Key} for project ${projectId} to S3.`);
        }
      } catch (s3Error) {
        LogError(s3Error as Error, serviceLocation, `Failed to upload segmentation JPEG for mask ${segmentationMaskId} to S3.`);
        // Decide if S3 upload failure should be a critical error for the client
      }

      // Check if project is already saved before updating it
      const projectResult = await readProject(projectId, userId);

      if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
        logger.warn(`${serviceLocation}: Could not find project ${projectId} to check save status, but segmentation mask ${segmentationMaskId} was saved (DB and S3 JPEG upload attempted).`);
      } else {
        const project = projectResult.projects[0];
        if (!project.isSaved) {
          const updateProjectResult = await updateProject(projectId, { isSaved: true });
          if (!updateProjectResult.success) {
            logger.warn(`${serviceLocation}: Failed to update project ${projectId} save status.`);
          } else {
            logger.info(`${serviceLocation}: Project ${projectId} save status updated to true.`);
          }
        } else {
          logger.info(`${serviceLocation}: Project ${projectId} already saved.`);
        }
      }

      logger.info(`${serviceLocation}: User ${userId} saved segmentation JPEG for mask ${segmentationMaskId}. DB status updated. S3 upload attempted.`);

      return res.status(200).json({
        success: true,
        message: "Segmentation JPEG saved successfully. Database updated and S3 upload initiated.",
        s3ImageUrl: s3ImageUrl, // Return the S3 URL of the image
        segmentation: segmentationDbUpdateResult.projectsegmentationmask
      });

    } catch (error) {
      // ... (existing error handling) ...
      const errorMessage = error instanceof Error ? error.message : String(error);
      LogError(
        error instanceof Error ? error : new Error(errorMessage),
        serviceLocation,
        `Error saving segmentation JPEG: ${req.body?.segmentationMaskId}`
      );
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred while saving the segmentation JPEG."
      });
    }
  }
);

// Route to save a user-uploaded preview JPEG AND update RLE for a MANUAL segmentation mask
router.patch("/save-manual-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
    const { 
        segmentationMaskId, 
        frameIndex: frameIndexStr, // Will be string from form-data
        sliceIndex: sliceIndexStr, // Will be string from form-data
        componentClass, 
        rleString 
    } = req.body; 
    const userId = (req.user)?._id;
    const uploadedFile = req.file; // The uploaded JPEG file

    logger.info(`${serviceLocation}: Received request to save manual segmentation (preview & RLE) for mask ID ${segmentationMaskId} by user ${userId}. File: ${uploadedFile?.originalname}. Slice: F${frameIndexStr}S${sliceIndexStr}, Class: ${componentClass}`);

    // === Validate request ===
    if (!userId) {
      logger.warn(`${serviceLocation}: Unauthorized attempt to save manual segmentation. User ID not found.`);
      return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
    }
    if (!segmentationMaskId) {
      logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving manual segmentation.`);
      return res.status(400).json({ success: false, message: "Missing segmentationMaskId." });
    }
    if (!uploadedFile) {
      logger.warn(`${serviceLocation}: Missing segmentationImage file for manual segmentation mask ${segmentationMaskId}.`);
      return res.status(400).json({ success: false, message: "Missing segmentationImage file." });
    }
    if (uploadedFile.mimetype !== 'image/jpeg') {
      logger.warn(`${serviceLocation}: Invalid file type for manual segmentation mask ${segmentationMaskId}. Expected JPEG, got ${uploadedFile.mimetype}.`);
      return res.status(400).json({ success: false, message: "Invalid file type. Only JPEG images are allowed." });
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

    // 1. Get the segmentation mask to find its project ID and verify it's a manual segmentation
    logger.debug(`${serviceLocation}: Reading segmentation mask ${segmentationMaskId} to verify type and get project ID.`);
    const maskResult = await readProjectSegmentationMask(segmentationMaskId);

    if (!maskResult.success || !maskResult.projectsegmentationmask) {
      logger.warn(`${serviceLocation}: Segmentation mask ${segmentationMaskId} not found for saving manual preview/RLE. Message: ${maskResult.message}`);
      return res.status(404).json({
        success: false,
        message: maskResult.message || "Segmentation mask not found."
      });
    }

    // Ensure this is indeed a manual segmentation mask (isMedSAMOutput should be false)
    if (maskResult.projectsegmentationmask.isMedSAMOutput) {
      logger.warn(`${serviceLocation}: Attempt to save RLE/preview for AI segmentation mask ${segmentationMaskId} via manual route. User: ${userId}`);
      return res.status(400).json({
        success: false,
        message: "This endpoint is for saving manual segmentations. The provided mask ID corresponds to an AI-generated segmentation."
      });
    }

    const projectId = maskResult.projectsegmentationmask.projectid;
    logger.info(`${serviceLocation}: Segmentation mask ${segmentationMaskId} (manual) belongs to project ${projectId}. Proceeding with RLE update and preview save.`);

    // 2. Prepare update payload for RLE and isSaved status
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
        logger.info(`${serviceLocation}: RLE for mask ${segmentationMaskId}, F${frameIndex}S${sliceIndex}, Class ${componentClass} was not modified or added (already up-to-date or target not found for update). Proceeding with save status and preview.`);
        // If the RLE didn't change, you might only want to update isSaved if it's not already true.
        // However, for simplicity, we'll update both.
    }
    
    const updatePayload: any = { // Use 'any' for flexibility or define a more specific update type
        isSaved: true,
    };
    if (rleActuallyModified) { // Only include frames in payload if they were actually changed
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

    // 3. Save the uploaded JPEG to S3
    let s3ImageUrl = '';
    try {
      const s3Key = `seg_mask_manual/${projectId}/${segmentationMaskId}-${Date.now()}.jpeg`;
      if (!process.env.S3_BUCKET_NAME) {
        logger.error(`${serviceLocation}: S3_BUCKET_NAME environment variable is not set. Cannot upload manual segmentation image for mask ${segmentationMaskId}.`);
      } else {
        logger.debug(`${serviceLocation}: Uploading manual segmentation preview ${uploadedFile.originalname} to S3 key ${s3Key} for mask ${segmentationMaskId}.`);
        await uploadSegMaskToS3(
          process.env.S3_BUCKET_NAME,
          s3Key,
          uploadedFile.buffer,
          uploadedFile.mimetype
        );
        s3ImageUrl = `s3://${process.env.S3_BUCKET_NAME}/${s3Key}`;
        logger.info(`${serviceLocation}: Successfully uploaded manual segmentation JPEG ${s3Key} for mask ${segmentationMaskId} to S3. URL: ${s3ImageUrl}`);
      }
    } catch (s3Error) {
      LogError(s3Error as Error, serviceLocation, `Failed to upload manual segmentation JPEG for mask ${segmentationMaskId} to S3.`);
      // S3 upload failure is not critical for the client response here, but logged
    }

    // 4. Check if the parent project is already saved before updating it
    logger.debug(`${serviceLocation}: Checking save status of parent project ${projectId} for manual segmentation mask ${segmentationMaskId}.`);
    const projectResult = await readProject(projectId, userId.toString()); // Ensure userId is string

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

    logger.info(`${serviceLocation}: User ${userId} successfully processed save request for manual segmentation (RLE & preview) for mask ${segmentationMaskId}. DB status updated. S3 upload attempted. Image URL: ${s3ImageUrl}`);
    return res.status(200).json({
      success: true,
      message: "Manual segmentation (RLE & preview) saved successfully. Database updated and S3 upload initiated.",
      s3ImageUrl: s3ImageUrl,
      segmentation: segmentationDbUpdateResult.projectsegmentationmask // Return the fully updated mask
    });

  } catch (error) {
    const segmentationMaskIdBody = req.body?.segmentationMaskId || "unknown"; // Renamed to avoid conflict in catch block
    const errorMessage = error instanceof Error ? error.message : String(error);
    LogError(
      error instanceof Error ? error : new Error(errorMessage),
      serviceLocation,
      `Error saving manual segmentation (RLE & preview) for mask ID: ${segmentationMaskIdBody}`
    );
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while saving the manual segmentation."
    });
  }
});

export default router;