import express, { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
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

router.post("/gpu-reconstruction-callback", gpuObjUploadFilter, async (req: Request, res: Response) => {
  const uploadedFiles = req.files as Express.Multer.File[];
  
  logger.info(
    `${serviceLocation}: Received 4D reconstruction callback from Cloud GPU. Headers:`,
    req.headers,
    "Body fields:",
    Object.keys(req.body),
    "Files received:",
    uploadedFiles?.length || 0
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
        `${serviceLocation}: Processing 4D reconstruction mesh results for job ${gpuJobId}, project ${projectId}.`
      );

      // Validate uploaded OBJ files presence
      if (!uploadedFiles || uploadedFiles.length === 0) {
        logger.error(
          `${serviceLocation}: No OBJ files received in multipart callback for job ${gpuJobId}`
        );
        return res.status(400).json({ 
          message: "No OBJ files received in reconstruction callback" 
        });
      }

      // Validate all uploaded files are OBJ format
      const invalidFiles = uploadedFiles.filter(file => !file.originalname.toLowerCase().endsWith('.obj'));
      if (invalidFiles.length > 0) {
        logger.error(
          `${serviceLocation}: Invalid file formats received for job ${gpuJobId}. Expected .obj files, Received: ${invalidFiles.map(f => f.originalname).join(', ')}`
        );
        return res.status(400).json({ 
          message: `Invalid file formats. Expected .obj files, Received: ${invalidFiles.map(f => f.originalname).join(', ')}` 
        });
      }

      logger.info(
        `${serviceLocation}: Valid OBJ files received for job ${gpuJobId}. File count: ${uploadedFiles.length}, Total size: ${uploadedFiles.reduce((sum, f) => sum + f.size, 0)} bytes`
      );

      // Get project details for userId and filehash
      let userId: string | undefined;
      let filehash: string | undefined;
      
      const projectResult = await readProject(projectId);
      if (projectResult.success && projectResult.project) {
        userId = projectResult.project.userid;
        filehash = projectResult.project.filehash;
        logger.info(`${serviceLocation}: Retrieved project details for job ${gpuJobId} - userId: ${userId}, filehash: ${filehash?.substring(0, 10)}...`);
      } else {
        logger.warn(`${serviceLocation}: Could not retrieve project details for job ${gpuJobId}, project ${projectId}. Using fallback naming.`);
      }

      // Process uploaded OBJ files from GPU server
      const processedObjFiles: Array<{
        filename: string;
        originalName: string;
        tempPath: string;
        size: number;
        frameIndex?: number;
      }> = [];
      
      try {
        logger.info(`${serviceLocation}: Processing ${uploadedFiles.length} OBJ files for job ${gpuJobId}`);
        
        for (const file of uploadedFiles) {
          // Extract frame index from filename if present (e.g., frame_001.obj, heart_frame_2.obj)
          const frameMatch = file.originalname.match(/frame[_-]?(\d+)/i);
          const frameIndex = frameMatch ? parseInt(frameMatch[1], 10) : undefined;
          
          processedObjFiles.push({
            filename: file.filename, // Multer generated filename
            originalName: file.originalname, // Original filename from GPU
            tempPath: file.path, // Full path to temporary file
            size: file.size,
            frameIndex: frameIndex,
          });
          
          logger.info(`${serviceLocation}: Processed OBJ file ${file.originalname} (${file.size} bytes) ${frameIndex !== undefined ? `for frame ${frameIndex}` : 'with no frame info'}`);
        }
        
        logger.info(`${serviceLocation}: Successfully processed ${processedObjFiles.length} OBJ files for job ${gpuJobId}`);
        
        // TODO: Upload OBJ files to S3 here
        // for (const objFile of processedObjFiles) {
        //   const s3UploadResult = await uploadObjToS3(objFile.tempPath, projectId, gpuJobId, objFile.frameIndex);
        // }
        
      } catch (processingError) {
        logger.error(`${serviceLocation}: Error during OBJ file processing for job ${gpuJobId}:`, processingError);
        // Continue with reconstruction record creation even if some processing fails
      }

      // Create reconstruction record with multiple OBJ files information
      const reconstructionName = currentJob.segmentationName || `4D Reconstruction - Job ${gpuJobId.substring(0, 8)}`;
      const reconstructionDescription = currentJob.segmentationDescription || `4D myocardium reconstruction from job ${gpuJobId} with ${processedObjFiles.length} frames`;
      
      // For multiple files, we'll create a single reconstruction record that represents the entire 4D result
      // The primary mesh file will be the first one, but we'll store info about all files in the result
      const primaryObjFile = processedObjFiles[0];
      
      // Generate structured filename for the primary file
      let primaryObjFilename: string;
      if (userId && filehash) {
        primaryObjFilename = `${userId}_${filehash}_multiframe.obj`;
      } else {
        primaryObjFilename = `${projectId}_reconstruction_${gpuJobId.substring(0, 8)}_multiframe.obj`;
      }
      
      // Generate temporary hash for the combined files (will be updated after S3 upload)
      const tempCombinedHash = crypto
        .createHash('sha256')
        .update(processedObjFiles.map(f => f.originalName).join(''))
        .digest('hex')
        .substring(0, 16);

      const reconstructionData: Partial<IProjectReconstruction> = {
        projectid: projectId,
        maskId: projectId, // TODO: Get actual maskId from job context when available
        name: reconstructionName,
        description: reconstructionDescription,
        ed_frame: gpuResult.ed_frame || 1, // End-diastole frame from GPU result
        isSaved: false,
        isAIGenerated: true,
        meshFormat: MeshFormat.OBJ, // Use the enum value
        filename: primaryObjFilename,
        filesize: processedObjFiles.reduce((sum, file) => sum + file.size, 0), // Total size of all files
        filehash: tempCombinedHash, // Temporary hash, will be updated after S3 upload
        basepath: ``, // S3 base path
        reconstructionfolderpath: ``, // S3 folder path
        reconstructedMesh: {
          path: ``, // S3 path for primary mesh, remove when bundle the obj into tar
          filename: primaryObjFilename,
          filesize: primaryObjFile.size,
          hash: tempCombinedHash, // Will be updated with actual file hash after S3 upload
          format: "obj",
          reconstructionTime: gpuResult.reconstruction_time,
          numIterations: gpuResult.num_iterations,
          resolution: gpuResult.resolution,
          // Store information about all OBJ files in a custom field
          meshData: JSON.stringify({
            totalFiles: processedObjFiles.length,
            tempFiles: processedObjFiles.map(file => file.tempPath), // Include temp paths for S3 upload
            files: processedObjFiles.map(file => ({
              originalName: file.originalName,
              size: file.size,
              frameIndex: file.frameIndex,
              s3Key: `reconstructions/${projectId}/${gpuJobId}/${file.originalName}` // Expected S3 key
            }))
          })
        },
      };

      // Store OBJ file information in job result
      // Workflow: GPU -> Webhook (multipart OBJ files) -> Job Result -> S3 upload
      const updateResultWithMesh = await updateJob(gpuJobId, {
        ...jobUpdatePayload,
        result: JSON.stringify({
          ...gpuResult,
          obj_files_received: true, // Flag to indicate OBJ files are available for S3 upload
          reconstruction_created: true, // Flag to indicate reconstruction record exists
          files_count: processedObjFiles.length,
          total_size: processedObjFiles.reduce((sum, file) => sum + file.size, 0),
          temp_files: processedObjFiles.map(file => file.tempPath), // Store temp file paths for cleanup
        }),
      });

      if (!updateResultWithMesh.success) {
        logger.error(
          `${serviceLocation}: Failed to update job with mesh data for GPU Job ID ${gpuJobId}`
        );
      }

      // Create reconstruction record in database
      const createResult = await createProjectReconstruction(reconstructionData as IProjectReconstruction);

      if (createResult.success && createResult.projectreconstruction) {
        logger.info(
          `${serviceLocation}: Successfully created reconstruction ${createResult.projectreconstruction._id} for project ${projectId} from job ${gpuJobId}.`
        );
      } else {
        logger.error(
          `${serviceLocation}: Failed to create reconstruction record for job ${gpuJobId}: ${createResult.message}`
        );
      }

      // Cleanup uploaded temporary OBJ files after processing
      try {
        for (const objFile of processedObjFiles) {
          try {
            await fs.unlink(objFile.tempPath);
            logger.debug(`${serviceLocation}: Cleaned up temporary OBJ file: ${objFile.tempPath}`);
          } catch (fileError) {
            logger.warn(`${serviceLocation}: Failed to delete temporary file ${objFile.tempPath}:`, fileError);
          }
        }
        logger.info(`${serviceLocation}: Cleaned up ${processedObjFiles.length} temporary OBJ files for job ${gpuJobId}`);
      } catch (cleanupError) {
        logger.warn(`${serviceLocation}: Failed to cleanup temporary OBJ files for job ${gpuJobId}:`, cleanupError);
        // Don't fail the webhook response due to cleanup issues
      }
    }

    return res
      .status(200)
      .json({ message: "4D reconstruction callback processed, job status updated." });
  } catch (dbError) {
    LogError(
      dbError as Error,
      serviceLocation,
      `Unexpected error while processing 4D reconstruction webhook for GPU Job ID ${gpuJobId}`
    );
    return res
      .status(500)
      .json({ message: "Unexpected error occurred while processing 4D reconstruction webhook" });
  }
});

export default router;
