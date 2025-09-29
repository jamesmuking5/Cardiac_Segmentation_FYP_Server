import express, { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import multer from "multer";
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

// Pre-multer middleware function for detailed logging
const preMulterLogging = (req: Request, res: Response, next: NextFunction) => {
  logger.info(`${serviceLocation}: [PRE-MULTER] Incoming request analysis:`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - Method: ${req.method}`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - Content-Type: ${req.headers['content-type']}`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - Content-Length: ${req.headers['content-length']}`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - X-Job-ID: ${req.headers['x-job-id']}`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - X-File-Count: ${req.headers['x-file-count']}`);
  logger.info(`${serviceLocation}: [PRE-MULTER] - User-Agent: ${req.headers['user-agent']}`);
  
  // Check if this is multipart/form-data
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    logger.warn(`${serviceLocation}: [PRE-MULTER] ⚠️  Content-Type is not multipart/form-data: ${contentType}`);
  } else {
    logger.info(`${serviceLocation}: [PRE-MULTER] ✅ Content-Type is multipart/form-data`);
  }
  
  next();
};

// Enhanced multer error handler
const handleMulterError = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    logger.error(`${serviceLocation}: [MULTER ERROR] MulterError occurred:`, {
      code: error.code,
      message: error.message,
      field: error.field,
      stack: error.stack
    });
    
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        logger.error(`${serviceLocation}: [MULTER ERROR] File too large. Limit: 50MB per file`);
        break;
      case 'LIMIT_FILE_COUNT':
        logger.error(`${serviceLocation}: [MULTER ERROR] Too many files. Limit: 50 files`);
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        logger.error(`${serviceLocation}: [MULTER ERROR] Unexpected file field: ${error.field}`);
        break;
      case 'LIMIT_PART_COUNT':
        logger.error(`${serviceLocation}: [MULTER ERROR] Too many form parts`);
        break;
      default:
        logger.error(`${serviceLocation}: [MULTER ERROR] Other multer error: ${error.code}`);
    }
    
    return res.status(400).json({
      error: 'File upload error',
      code: error.code,
      message: error.message
    });
  } else if (error) {
    logger.error(`${serviceLocation}: [REQUEST ERROR] Non-multer error:`, error);
    return res.status(500).json({
      error: 'Server error during file processing',
      message: error.message
    });
  }
  
  next();
};

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

/*
 * 4D Reconstruction Callback - Enhanced with comprehensive debugging and metadata handling
 * 
 * IMPROVEMENTS IMPLEMENTED:
 * ✅ Pre-multer logging: Content-Type, Content-Length, headers analysis
 * ✅ Enhanced multer error handling: Specific error codes and detailed logging
 * ✅ Increased file limits: 50MB per file, 50 files max, 100 form parts
 * ✅ Detailed file filter debugging: Logs every file acceptance/rejection
 * ✅ Post-multer analysis: Complete file breakdown by type with full details
 * ✅ Safe array handling: Prevents undefined errors in file processing
 * ✅ JSON metadata file parsing: Reads metadata from uploaded .json files
 * ✅ OBJ-only processing: Passes only OBJ files to reconstruction handler
 * ✅ Fallback metadata parsing: Supports form fields as backup
 * 
 * PROCESSING FLOW:
 * 1. Accept both .obj mesh files and .json metadata files via multipart upload
 * 2. Parse JSON metadata from uploaded metadata.json file (preferred)
 * 3. Fallback to form field metadata if no JSON file present
 * 4. Filter and process only OBJ files for reconstruction
 * 5. Pass parsed metadata and OBJ files to reconstruction handler
 */
router.post("/gpu-reconstruction-callback", preMulterLogging, gpuObjUploadFilter, handleMulterError, async (req: Request, res: Response) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || [];
  
  logger.info(`${serviceLocation}: [POST-MULTER] Detailed file processing results:`);
  logger.info(`${serviceLocation}: [POST-MULTER] - Total files received: ${uploadedFiles.length}`);
  
  // Log each file with full details
  uploadedFiles.forEach((file, index) => {
    logger.info(`${serviceLocation}: [POST-MULTER] File ${index + 1}:`, {
      fieldname: file.fieldname,
      originalname: file.originalname,
      encoding: file.encoding,
      mimetype: file.mimetype,
      size: file.size,
      destination: file.destination,
      filename: file.filename,
      path: file.path
    });
  });
  
  // Analyze file types
  const objFiles = uploadedFiles.filter(f => f.originalname.toLowerCase().endsWith('.obj'));
  const jsonFiles = uploadedFiles.filter(f => f.originalname.toLowerCase().endsWith('.json'));
  const otherFiles = uploadedFiles.filter(f => !f.originalname.toLowerCase().endsWith('.obj') && !f.originalname.toLowerCase().endsWith('.json'));
  
  logger.info(`${serviceLocation}: [POST-MULTER] File type breakdown:`);
  logger.info(`${serviceLocation}: [POST-MULTER] - OBJ files: ${objFiles.length}`);
  logger.info(`${serviceLocation}: [POST-MULTER] - JSON files: ${jsonFiles.length}`);
  logger.info(`${serviceLocation}: [POST-MULTER] - Other files: ${otherFiles.length}`);
  
  logger.info(`${serviceLocation}: [POST-MULTER] Request body fields:`, Object.keys(req.body));
  
  if (objFiles.length > 0) {
    logger.info(`${serviceLocation}: [POST-MULTER] ✅ SUCCESS: Found ${objFiles.length} OBJ files`);
    objFiles.forEach((file, index) => {
      logger.info(`${serviceLocation}: [POST-MULTER] OBJ ${index + 1}: ${file.originalname} (${file.size} bytes, field: ${file.fieldname})`);
    });
  } else {
    logger.warn(`${serviceLocation}: [POST-MULTER] ⚠️  WARNING: No OBJ files found in upload`);
  }

  const gpuJobId = req.headers["x-job-id"] as string | undefined;

  // Validate job ID is present
  if (!gpuJobId) {
    logger.error(`${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers`);
    return res.status(400).json({ message: "Missing Cloud GPU Job ID in headers" });
  }

  logger.info(`${serviceLocation}: Processing reconstruction callback for job ${gpuJobId}`);

  // Parse callback metadata from uploaded JSON file
  let callbackMetadata;
  try {
    logger.info(`${serviceLocation}: [METADATA PARSING] Starting metadata extraction for job ${gpuJobId}`);
    logger.info(`${serviceLocation}: [METADATA PARSING] Available files: ${uploadedFiles.length}, JSON files: ${jsonFiles.length}, OBJ files: ${objFiles.length}`);
    
    // First try to parse from uploaded JSON metadata file
    if (jsonFiles.length > 0) {
      logger.info(`${serviceLocation}: [METADATA PARSING] Found ${jsonFiles.length} JSON file(s), attempting to parse metadata from file`);
      
      const metadataFile = jsonFiles[0]; // Use first JSON file as metadata
      logger.info(`${serviceLocation}: [METADATA PARSING] Reading metadata from file: ${metadataFile.originalname} (${metadataFile.size} bytes)`);
      
      try {
        const fs = await import('fs');
        const metadataContent = await fs.promises.readFile(metadataFile.path, 'utf-8');
        callbackMetadata = JSON.parse(metadataContent);
        logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Successfully parsed JSON metadata from uploaded file ${metadataFile.originalname}`);
        logger.info(`${serviceLocation}: [METADATA PARSING] Metadata keys: ${Object.keys(callbackMetadata).join(', ')}`);
      } catch (parseError) {
        logger.error(`${serviceLocation}: [METADATA PARSING] ❌ Failed to parse JSON metadata from file ${metadataFile.originalname}:`, parseError);
        throw new Error(`Invalid JSON metadata file: ${(parseError as Error).message}`);
      }
    }
    // Fallback to form fields if no JSON file is present
    else if (req.body.metadata) {
      logger.info(`${serviceLocation}: [METADATA PARSING] No JSON file found, attempting to parse from form field 'metadata'`);
      
      if (typeof req.body.metadata === 'string') {
        try {
          callbackMetadata = JSON.parse(req.body.metadata);
          logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Successfully parsed JSON metadata from form field`);
        } catch (parseError) {
          logger.error(`${serviceLocation}: [METADATA PARSING] ❌ JSON parse error for metadata field:`, parseError);
          throw parseError;
        }
      } else {
        callbackMetadata = req.body.metadata;
        logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Using metadata object directly from form field`);
      }
    }
    // Fallback to individual form fields (legacy support)
    else if (req.body.uuid && req.body.status !== undefined) {
      logger.info(`${serviceLocation}: [METADATA PARSING] No JSON file or metadata field found, using individual form fields for job ${gpuJobId}`);
      
      // Reconstruct the expected callback structure from individual fields
      callbackMetadata = {
        uuid: req.body.uuid,
        status: req.body.status,
        result: req.body.result,
        error: req.body.error
      };
      
      // Parse result field if it's a JSON string
      if (typeof req.body.result === 'string') {
        try {
          callbackMetadata.result = JSON.parse(req.body.result);
          logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Parsed result JSON from form field for job ${gpuJobId}`);
        } catch (parseError) {
          logger.warn(`${serviceLocation}: [METADATA PARSING] ⚠️  Could not parse result as JSON for job ${gpuJobId}, using as string`);
        }
      }
      
      logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Form field metadata - UUID: ${callbackMetadata.uuid}, Status: ${callbackMetadata.status}`);
    }
    // No valid metadata source found
    else {
      throw new Error(`No valid metadata source found. Expected: JSON file upload, 'metadata' form field, or individual form fields (uuid, status). Available: JSON files: ${jsonFiles.length}, form fields: ${Object.keys(req.body).join(', ')}`);
    }
    
    // Log parsed metadata structure for debugging
    if (callbackMetadata) {
      logger.info(`${serviceLocation}: [METADATA PARSING] ✅ Final metadata structure for job ${gpuJobId}:`);
      logger.info(`${serviceLocation}: [METADATA PARSING] - UUID: ${callbackMetadata.uuid || gpuJobId}`);
      logger.info(`${serviceLocation}: [METADATA PARSING] - Status: ${callbackMetadata.status}`);
      logger.info(`${serviceLocation}: [METADATA PARSING] - Has result: ${!!callbackMetadata.result}`);
      logger.info(`${serviceLocation}: [METADATA PARSING] - Has error: ${!!callbackMetadata.error}`);
      
      // Log detailed result metadata if available
      if (callbackMetadata.result && typeof callbackMetadata.result === 'object') {
        const result = callbackMetadata.result;
        logger.info(`${serviceLocation}: [METADATA PARSING] - Result metadata:`, {
          mesh_filename: result.mesh_filename,
          total_mesh_files: result.total_mesh_files,
          total_mesh_size: result.total_mesh_size,
          mesh_format: result.mesh_format,
          status: result.status,
          message: result.message,
          is_4d_input: result.is_4d_input,
          total_frames: result.total_frames,
          processed_frames: result.processed_frames,
          mesh_files_info_count: result.mesh_files_info?.length || 0
        });
      }
    }
    
  } catch (e) {
    logger.error(`${serviceLocation}: [METADATA PARSING] ❌ CRITICAL ERROR parsing GPU metadata for job ${gpuJobId}:`, {
      error: e,
      message: (e as Error).message,
      stack: (e as Error).stack,
      requestBodyKeys: Object.keys(req.body),
      requestHeaders: req.headers
    });
    return res.status(400).json({ 
      message: "Invalid multipart form data structure",
      error: (e as Error).message,
      expected: "Form field 'metadata' containing JSON string"
    });
  }

  try {
    logger.info(`${serviceLocation}: [PROCESSING] Starting reconstruction processing for job ${gpuJobId}`);
    logger.info(`${serviceLocation}: [PROCESSING] Total uploaded files: ${uploadedFiles.length}`);
    logger.info(`${serviceLocation}: [PROCESSING] OBJ files available: ${objFiles.length}`);
    logger.info(`${serviceLocation}: [PROCESSING] JSON files available: ${jsonFiles.length}`);
    
    // Validate that we have OBJ files to process
    if (objFiles.length > 0) {
      logger.info(`${serviceLocation}: [PROCESSING] ✅ Found ${objFiles.length} OBJ files to process:`);
      objFiles.forEach((file, index) => {
        logger.info(`${serviceLocation}: [PROCESSING]   ${index + 1}. ${file.originalname} (${file.size} bytes, saved as: ${file.filename})`);
      });
    } else {
      logger.warn(`${serviceLocation}: [PROCESSING] ⚠️  WARNING - No OBJ files received for job ${gpuJobId}.`);
      
      // Check if metadata indicates files should be present
      const expectedFiles = callbackMetadata?.result?.total_mesh_files || callbackMetadata?.total_mesh_files;
      if (expectedFiles > 0) {
        logger.error(`${serviceLocation}: Metadata indicates ${expectedFiles} mesh files should be present, but none received for job ${gpuJobId}`);
      }
    }
    
    // Log any non-OBJ files that were also uploaded (for debugging)
    const nonObjFiles = uploadedFiles.filter(f => !f.originalname.toLowerCase().endsWith('.obj') && !f.originalname.toLowerCase().endsWith('.json'));
    if (nonObjFiles.length > 0) {
      logger.warn(`${serviceLocation}: [PROCESSING] ⚠️  Unexpected non-OBJ/non-JSON files received for job ${gpuJobId}: ${nonObjFiles.map(f => `${f.originalname} (${f.fieldname})`).join(', ')}`);
    }
    
    logger.info(`${serviceLocation}: [PROCESSING] Calling reconstruction handler with ${objFiles.length} OBJ files and parsed metadata`);
    
    // Process reconstruction using the service layer - pass only OBJ files
    const result = await processReconstructionCallback(gpuJobId, objFiles, callbackMetadata);
    
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