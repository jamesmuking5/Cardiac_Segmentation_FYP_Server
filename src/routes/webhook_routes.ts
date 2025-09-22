import express, { Request, Response, NextFunction } from "express";
import logger from "../services/logger"; // Import Winston Logger
import {
  updateJob,
  readJob,
  createProjectSegmentationMask,
  createProjectReconstruction,
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

router.post("/gpu-reconstruction-callback", async (req: Request, res: Response) => {
  logger.info(
    `${serviceLocation}: Received 4D reconstruction callback from Cloud GPU. Headers:`,
    req.headers,
    "Body keys:",
    Object.keys(req.body)
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

      // Validate mesh data presence and format
      if (!gpuResult.mesh_data || typeof gpuResult.mesh_data !== "string") {
        logger.error(
          `${serviceLocation}: Missing or invalid mesh_data in callback for job ${gpuJobId}`
        );
        return res.status(400).json({ 
          message: "Missing or invalid mesh_data in reconstruction callback" 
        });
      }

      // Validate mesh data is valid Base64
      try {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(gpuResult.mesh_data)) {
          throw new Error("Invalid Base64 format");
        }
        // Test decode to ensure it's valid Base64 data
        Buffer.from(gpuResult.mesh_data, 'base64');
      } catch (error) {
        logger.error(
          `${serviceLocation}: Invalid Base64 mesh_data in callback for job ${gpuJobId}: ${error}`
        );
        return res.status(400).json({ 
          message: "Invalid Base64 mesh_data in reconstruction callback" 
        });
      }

      logger.info(
        `${serviceLocation}: Valid mesh data received for job ${gpuJobId}. Size: ${gpuResult.mesh_file_size || 'unknown'} bytes, Format: ${gpuResult.mesh_format || 'npz'}`
      );

      // Create reconstruction record with simplified structure
      const reconstructionName = currentJob.segmentationName || `4D Reconstruction - Job ${gpuJobId.substring(0, 8)}`;
      const reconstructionDescription = currentJob.segmentationDescription || `4D myocardium reconstruction from job ${gpuJobId}`;
      
      // Will be converted to OBJ format before S3 upload
      const objFilename = `${projectId}_reconstruction_${gpuJobId.substring(0, 8)}.obj`;
      
      const reconstructionData: Partial<IProjectReconstruction> = {
        projectid: projectId,
        maskId: projectId, // TODO: Get actual maskId from job context when available
        name: reconstructionName,
        description: reconstructionDescription,
        isSaved: false,
        isAIGenerated: true,
        reconstructedMesh: {
          path: "pending", // Will be populated with S3 URL after NPZ->OBJ conversion and upload
          filename: objFilename,
          filesize: 0, // Will be calculated after OBJ conversion
          hash: "pending", // Will be calculated during OBJ conversion and S3 upload
          format: "obj", // Final format after conversion from NPZ
          reconstructionTime: gpuResult.reconstruction_time,
          numIterations: gpuResult.num_iterations,
          resolution: gpuResult.resolution,
        },
      };

      // Store mesh data in job result for NPZ->OBJ conversion processing
      // Workflow: GPU -> Webhook -> Job Result (with Base64 NPZ data) -> Background NPZ decode -> OBJ conversion -> S3 upload
      const updateResultWithMesh = await updateJob(gpuJobId, {
        ...jobUpdatePayload,
        result: JSON.stringify({
          ...gpuResult,
          mesh_data_stored: true, // Flag to indicate NPZ mesh data is available for processing
          reconstruction_created: true, // Flag to indicate reconstruction record exists
          conversion_required: "npz_to_obj", // Flag to indicate conversion workflow needed
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
