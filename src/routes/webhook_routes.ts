import express, { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import logger from "../services/logger"; // Import Winston Logger
import {
  updateJob,
  readJob,
  createProjectSegmentationMask,
  createProjectReconstruction,
  readProject,
} from "../services/database"; // Import database function to update job status
import {
  JobStatus,
  IProjectSegmentationMask,
  ComponentBoundingBoxesClass,
  CRUDOperation,
  IJob,
  IProjectSegmentationMaskDocument,
  IProjectReconstruction,
  MeshFormat,
} from "../types/database_types"; // Import JobStatus enum and IJob type
import LogError from "../utils/error_logger";
import { v4 as uuidv4 } from "uuid"; // For generating new _id for the manual mask
import { gpuObjUploadFilter } from "../middleware/uploadmiddleware";
import { processReconstructionCallback } from "../services/reconstruction_handler";

const serviceLocation = "InferenceCallback(Webhook)";
const router = express.Router();

// Helper function for deep copying frames data
const deepCopyFrames = (
  frames: IProjectSegmentationMaskDocument["frames"]
): IProjectSegmentationMaskDocument["frames"] => {
  return JSON.parse(JSON.stringify(frames));
};

router.post("/gpu-callback", async (req: Request, res: Response) => {
  logger.info(
    `${serviceLocation}: Received callback from Cloud GPU. Headers:`,
    req.headers,
    "Body:",
    req.body
  );

  const gpuJobId = req.headers["x-job-id"] as string | undefined;

  if (gpuJobId) {
    logger.info(
      `${serviceLocation}: Cloud GPU Job ID received in header: ${gpuJobId}`
    );
  } else {
    logger.error(
      `${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers. Body:`,
      req.body
    );
    return res.status(400).json("Missing Cloud GPU Job ID in headers");
  }

  const jobReadResult = await readJob(gpuJobId);
  if (!jobReadResult.success || !jobReadResult.job) {
    logger.error(
      `${serviceLocation}: Job with GPU Job ID ${gpuJobId} not found in database. Reason: ${jobReadResult.message || "Job not found"}`
    );
    return res
      .status(404)
      .json({ message: `Job with GPU Job ID ${gpuJobId} not found` });
  }
  // const job = jobReadResult.job; // Get the full job object // Not directly used, currentJob is used later

  const { status, result: gpuResult, error: gpuErrorDetail } = req.body;

  if (!status) {
    logger.error(
      `${serviceLocation}: Callback missing status for job UUID ${gpuJobId}.`
    );
    return res.status(400).json({ message: "Missing status in callback body" });
  }

  let jobStatus: JobStatus;
  let jobMessage: string | undefined = gpuErrorDetail
    ? typeof gpuErrorDetail === "string"
      ? gpuErrorDetail
      : JSON.stringify(gpuErrorDetail)
    : undefined;

  if (status === "completed" || status === "success") {
    jobStatus = JobStatus.COMPLETED;
  } else if (status === "failed") {
    jobStatus = JobStatus.FAILED;
  } else if (status === "processing") {
    jobStatus = JobStatus.IN_PROGRESS;
  } else {
    logger.warn(
      `${serviceLocation}: Unknown status received: ${status}. Defaulting to PENDING.`
    );
    jobStatus = JobStatus.PENDING;
    if (!jobMessage) jobMessage = `Unknown status received from GPU: ${status}`;
  }

  try {
    const jobUpdatePayload: Partial<IJob> = {
      status: jobStatus,
      result: gpuResult
        ? typeof gpuResult === "string"
          ? gpuResult
          : JSON.stringify(gpuResult)
        : undefined,
      message: jobMessage,
    };

    const updateResult = await updateJob(gpuJobId, jobUpdatePayload);

    if (!updateResult.success || !updateResult.job) {
      logger.error(
        `${serviceLocation}: Failed to update job with GPU Job ID ${gpuJobId}. Reason: ${updateResult.message || "Job not found after update"}`
      );
      return res
        .status(500)
        .json({
          message: `Failed to update job status or retrieve job after update: ${updateResult.message}`,
        });
    }
    logger.info(
      `${serviceLocation}: Successfully updated job with GPU Job ID ${gpuJobId} to status ${jobStatus}.`
    );

    if (
      jobStatus === JobStatus.COMPLETED &&
      gpuResult &&
      typeof gpuResult === "object" &&
      Object.keys(gpuResult).length > 0
    ) {
      const currentJob = updateResult.job;
      if (!currentJob) {
        logger.error(
          `${serviceLocation}: Job with UUID ${gpuJobId} not found after update during webhook processing.`
        );
        return res
          .status(404)
          .json({ message: `Job ${gpuJobId} not found after update.` });
      }
      const projectId = currentJob.projectid;

      logger.info(
        `${serviceLocation}: Processing structured segmentation results for job ${gpuJobId}, project ${projectId}. Segmentation source from job: ${currentJob.segmentationSource}`
      );

      const aiSegmentationSet: Partial<IProjectSegmentationMask> = {
        projectid: projectId,
        name:
          currentJob.segmentationName ||
          `AI Output - Job ${gpuJobId.substring(0, 8)}`,
        description:
          currentJob.segmentationDescription ||
          `AI segmentation results from job ${gpuJobId}`,
        isSaved: false,
        segmentationmaskRLE: true,
        isMedSAMOutput: true, // Explicitly true for AI output
        frames: [],
      };

      const framesDataMap = new Map<
        number,
        {
          frameindex: number;
          frameinferred: boolean;
          slices: Map<
            number,
            {
              sliceindex: number;
              componentboundingboxes: any[];
              segmentationmasks: any[];
            }
          >;
        }
      >();

      const mapGpuClassNameToEnum = (
        gpuClassName: string | undefined
      ): ComponentBoundingBoxesClass | undefined => {
        if (!gpuClassName) return undefined;
        const lowerGpuClassName = gpuClassName.toLowerCase();
        if (lowerGpuClassName === "rv") return ComponentBoundingBoxesClass.RV;
        if (lowerGpuClassName === "myo") return ComponentBoundingBoxesClass.MYO;
        if (lowerGpuClassName === "lvc" || lowerGpuClassName === "lv")
          return ComponentBoundingBoxesClass.LVC;
        logger.warn(
          `${serviceLocation}: Unknown GPU class name "${gpuClassName}" received for job ${gpuJobId}. Cannot map to enum.`
        );
        return undefined;
      };

      for (const [imageFilename, segmentationData] of Object.entries(
        gpuResult as Record<string, any>
      )) {
        if (typeof segmentationData !== "object" || segmentationData === null) {
          logger.warn(
            `${serviceLocation}: Invalid segmentation data for ${imageFilename} in job ${gpuJobId}. Skipping.`
          );
          continue;
        }

        const filenameParts = imageFilename.replace(/\.jpg$/i, "").split("_");
        let frameNumber: number | undefined;
        let sliceNumber: number | undefined;

        if (filenameParts.length >= 2) {
          const potentialSlice = parseInt(
            filenameParts[filenameParts.length - 1],
            10
          );
          const potentialFrame = parseInt(
            filenameParts[filenameParts.length - 2],
            10
          );
          if (!isNaN(potentialSlice) && !isNaN(potentialFrame)) {
            sliceNumber = potentialSlice;
            frameNumber = potentialFrame;
          } else {
            logger.warn(
              `${serviceLocation}: Could not parse frame/slice numbers from filename parts for ${imageFilename} in job ${gpuJobId}`
            );
          }
        }

        if (frameNumber === undefined || sliceNumber === undefined) {
          logger.warn(
            `${serviceLocation}: Could not parse valid frame/slice from filename ${imageFilename} for job ${gpuJobId}. Skipping entry.`
          );
          continue;
        }

        if (!framesDataMap.has(frameNumber)) {
          framesDataMap.set(frameNumber, {
            frameindex: frameNumber,
            frameinferred: true,
            slices: new Map(),
          });
        }
        const currentFrameData = framesDataMap.get(frameNumber)!;

        if (!currentFrameData.slices.has(sliceNumber)) {
          currentFrameData.slices.set(sliceNumber, {
            sliceindex: sliceNumber,
            componentboundingboxes: [],
            segmentationmasks: [],
          });
        }
        const currentSliceData = currentFrameData.slices.get(sliceNumber)!;

        if (segmentationData.boxes && Array.isArray(segmentationData.boxes)) {
          for (const box of segmentationData.boxes) {
            if (
              box &&
              typeof box === "object" &&
              box.bbox &&
              Array.isArray(box.bbox) &&
              box.bbox.length === 4
            ) {
              const mappedClass = mapGpuClassNameToEnum(box.class_name);
              if (mappedClass) {
                currentSliceData.componentboundingboxes.push({
                  class: mappedClass,
                  confidence:
                    typeof box.confidence === "number" ? box.confidence : 0,
                  x_min: box.bbox[0],
                  y_min: box.bbox[1],
                  x_max: box.bbox[2],
                  y_max: box.bbox[3],
                });
              } else {
                logger.warn(
                  `${serviceLocation}: Skipping box for ${imageFilename} due to unmappable class "${box.class_name}" in job ${gpuJobId}.`
                );
              }
            } else {
              logger.warn(
                `${serviceLocation}: Invalid box data for ${imageFilename}, class ${box?.class_name} in job ${gpuJobId}. Skipping box.`
              );
            }
          }
        }

        if (
          segmentationData.masks &&
          typeof segmentationData.masks === "object"
        ) {
          for (const [className, rleString] of Object.entries(
            segmentationData.masks
          )) {
            if (typeof rleString === "string") {
              const mappedClass = mapGpuClassNameToEnum(className);
              if (mappedClass) {
                currentSliceData.segmentationmasks.push({
                  class: mappedClass,
                  segmentationmaskcontents: rleString,
                });
              } else {
                logger.warn(
                  `${serviceLocation}: Skipping RLE mask for ${imageFilename} due to unmappable class "${className}" in job ${gpuJobId}.`
                );
              }
            } else {
              logger.warn(
                `${serviceLocation}: Invalid RLE string for ${imageFilename}, class ${className} in job ${gpuJobId}. Skipping mask.`
              );
            }
          }
        }
      }

      aiSegmentationSet.frames = Array.from(framesDataMap.values())
        .map((f) => ({
          ...f,
          slices: Array.from(f.slices.values()).sort(
            (a, b) => a.sliceindex - b.sliceindex
          ),
        }))
        .sort((a, b) => a.frameindex - b.frameindex);

      if (aiSegmentationSet.frames.length > 0) {
        const aiCreationResult = await createProjectSegmentationMask(
          aiSegmentationSet as IProjectSegmentationMask
        );
        if (
          aiCreationResult.success &&
          aiCreationResult.projectsegmentationmask
        ) {
          logger.info(
            `${serviceLocation}: Successfully created AI segmentation mask document for job ${gpuJobId}, project ${projectId}. Mask ID: ${aiCreationResult.projectsegmentationmask._id}`
          );

          // Now create the editable manual mask
          const manualSegmentationSet: IProjectSegmentationMask = {
            // _id: uuidv4(), // REMOVE THIS LINE - Let Mongoose generate the ObjectId
            projectid: projectId,
            name: `Manual Edit - ${currentJob.segmentationName || `Job ${gpuJobId.substring(0, 8)}`}`,
            description: `Editable manual segmentation, based on AI output from job ${gpuJobId}`,
            isSaved: false,
            segmentationmaskRLE: true,
            isMedSAMOutput: false, // Explicitly false for manual/editable mask
            frames: deepCopyFrames(
              aiCreationResult.projectsegmentationmask.frames
            ), // Deep copy frames from AI mask
          };

          const manualCreationResult = await createProjectSegmentationMask(
            manualSegmentationSet
          );
          if (
            manualCreationResult.success &&
            manualCreationResult.projectsegmentationmask
          ) {
            logger.info(
              `${serviceLocation}: Successfully created editable manual segmentation mask for project ${projectId}. AI Mask ID: ${aiCreationResult.projectsegmentationmask._id}, Manual Mask ID: ${manualCreationResult.projectsegmentationmask._id}`
            );
          } else {
            logger.error(
              `${serviceLocation}: Failed to create editable manual segmentation mask for project ${projectId} after AI mask creation. Reason: ${manualCreationResult.message}`
            );
            // Log this error, but don't fail the whole callback if AI mask was created.
          }
        } else {
          logger.error(
            `${serviceLocation}: Failed to create AI segmentation mask document for job ${gpuJobId}. Reason: ${aiCreationResult.message}`
          );
        }
      } else {
        logger.warn(
          `${serviceLocation}: No parsable frame/slice data found in GPU result for job ${gpuJobId}. Skipping structured segmentation storage.`
        );
      }
    }

    return res
      .status(200)
      .json({ message: "Callback processed, job status updated." });
  } catch (dbError) {
    LogError(
      dbError as Error,
      serviceLocation,
      `Unexpected error while processing webhook for GPU Job ID ${gpuJobId}`
    );
    return res
      .status(500)
      .json({ message: "Unexpected error occurred while processing webhook" });
  }
});

// 4D Reconstruction Callback - Uses Service Layer
router.post("/gpu-reconstruction-callback", gpuObjUploadFilter, async (req: Request, res: Response) => {
  const uploadedFiles = req.files as Express.Multer.File[];
  
  logger.info(
    `${serviceLocation}: Received 4D reconstruction callback from Cloud GPU. Headers:`,
    req.headers,
    "Raw Body fields:",
    Object.keys(req.body),
    "Raw Body values:",
    req.body,
    "Files received:",
    uploadedFiles?.length || 0
  );

  const gpuJobId = req.headers["x-job-id"] as string | undefined;

  // Validate job ID is present
  if (!gpuJobId) {
    logger.error(`${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers`);
    return res.status(400).json({ message: "Missing Cloud GPU Job ID in headers" });
  }

  logger.info(`${serviceLocation}: Processing reconstruction callback for job ${gpuJobId}`);

  // Parse callback metadata from multipart form data with enhanced logging
  let callbackMetadata;
  try {
    // Log raw request details for debugging
    logger.info(`${serviceLocation}: Raw request body structure for job ${gpuJobId}:`, {
      bodyKeys: Object.keys(req.body),
      bodyTypes: Object.keys(req.body).map(key => ({ [key]: typeof req.body[key] })),
      contentType: req.headers['content-type'],
      hasFiles: !!(req.files && Array.isArray(req.files) && req.files.length > 0)
    });
    
    // Try different possible field names for the JSON metadata
    let metadataString;
    
    if (req.body.metadata) {
      metadataString = req.body.metadata;
      logger.info(`${serviceLocation}: Found metadata field for job ${gpuJobId}`);
    } else if (req.body.json) {
      metadataString = req.body.json;
      logger.info(`${serviceLocation}: Found json field for job ${gpuJobId}`);
    } else if (req.body.data) {
      metadataString = req.body.data;
      logger.info(`${serviceLocation}: Found data field for job ${gpuJobId}`);
    } else if (req.body.result) {
      metadataString = req.body.result;
      logger.info(`${serviceLocation}: Found result field for job ${gpuJobId}`);
    } else {
      // If no specific metadata field, use the entire body
      logger.info(`${serviceLocation}: No metadata field found, using entire body for job ${gpuJobId}. Body keys: ${Object.keys(req.body).join(', ')}`);
      callbackMetadata = req.body;
    }
    
    if (metadataString) {
      if (typeof metadataString === 'string') {
        try {
          callbackMetadata = JSON.parse(metadataString);
          logger.info(`${serviceLocation}: Successfully parsed JSON metadata from string for job ${gpuJobId}. Parsed keys: ${Object.keys(callbackMetadata).join(', ')}`);
        } catch (parseError) {
          logger.error(`${serviceLocation}: JSON parse error for job ${gpuJobId}:`, parseError);
          logger.info(`${serviceLocation}: Raw metadata string that failed to parse: ${metadataString.substring(0, 500)}...`);
          throw parseError;
        }
      } else {
        callbackMetadata = metadataString;
        logger.info(`${serviceLocation}: Using metadata object directly for job ${gpuJobId}. Object keys: ${Object.keys(callbackMetadata).join(', ')}`);
      }
    }
  } catch (e) {
    logger.error(`${serviceLocation}: CRITICAL ERROR parsing Cloud GPU metadata for job ${gpuJobId}:`, {
      error: e,
      message: (e as Error).message,
      stack: (e as Error).stack,
      requestBodyKeys: Object.keys(req.body),
      requestHeaders: req.headers
    });
    logger.info(`${serviceLocation}: Attempting to use raw body as fallback for job ${gpuJobId}`);
    callbackMetadata = req.body;
  }

  try {
    // Log detailed request information for debugging 500 errors
    logger.info(`${serviceLocation}: Detailed callback request for job ${gpuJobId} - Metadata keys: ${Object.keys(callbackMetadata).join(', ')}, File names: ${uploadedFiles?.map(f => f.originalname).join(', ') || 'none'}`);
    
    // Process reconstruction using the service layer
    const result = await processReconstructionCallback(gpuJobId, uploadedFiles, callbackMetadata);
    
    if (result.success) {
      logger.info(`${serviceLocation}: Successfully processed reconstruction callback for job ${gpuJobId}`);
      return res.status(200).json({ 
        message: result.message,
        reconstructionId: result.reconstructionId 
      });
    } else {
      logger.error(`${serviceLocation}: Failed to process reconstruction callback for job ${gpuJobId}: ${result.message}${result.error ? ` - Error: ${result.error}` : ''}`);
      return res.status(500).json({ 
        message: result.message,
        error: result.error 
      });
    }
  } catch (error) {
    // Enhanced error logging for 500 errors with full diagnostic info
    const errorInfo = {
      error: error,
      stack: (error as Error).stack,
      message: (error as Error).message,
      errorName: (error as Error).name,
      uploadedFilesCount: uploadedFiles?.length || 0,
      uploadedFileNames: uploadedFiles?.map(f => f.originalname) || [],
      callbackMetadataKeys: callbackMetadata ? Object.keys(callbackMetadata) : 'none',
      callbackMetadata: callbackMetadata,
      requestBodyKeys: Object.keys(req.body),
      requestHeaders: req.headers,
      gpuJobId: gpuJobId,
      errorLocation: 'reconstruction-callback-main-try-catch'
    };
    
    logger.error(`${serviceLocation}: CRITICAL ERROR in reconstruction callback for job ${gpuJobId}:`, errorInfo);
    
    // Check if this is the "index out of bound" error specifically
    if ((error as Error).message.includes('out of bound') || (error as Error).message.includes('index')) {
      logger.error(`${serviceLocation}: ARRAY INDEX ERROR detected for job ${gpuJobId}. This suggests GPU result data structure mismatch.`);
    }
    
    LogError(
      error as Error,
      serviceLocation,
      `Unexpected error processing reconstruction callback for job ${gpuJobId} - ${(error as Error).message}`
    );
    return res.status(500).json({ 
      message: "Unexpected error occurred while processing reconstruction callback",
      error: (error as Error).message,
      errorType: (error as Error).name,
      jobId: gpuJobId
    });
  }
});

export default router;