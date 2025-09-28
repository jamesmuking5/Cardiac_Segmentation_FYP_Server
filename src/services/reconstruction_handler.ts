// File: src/services/reconstruction_handler.ts
// Description: Handles 4D cardiac reconstruction processing, TAR creation, and S3 uploads

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import logger from "./logger";
import { uploadToS3 } from "./s3_handler";
import {
  updateJob,
  createProjectReconstruction,
  readProject,
} from "./database";
import {
  JobStatus,
  IProjectReconstruction,
  MeshFormat,
} from "../types/database_types";
import LogError from "../utils/error_logger";

const serviceLocation = "ReconstructionHandler";

export interface ProcessedObjFile {
  filename: string;
  originalName: string;
  tempPath: string;
  size: number;
  frameIndex?: number;
}

export interface ReconstructionCallbackResult {
  success: boolean;
  message: string;
  reconstructionId?: string;
  error?: string;
}

/**
 * Main function to process 4D reconstruction callback from GPU server
 */
export async function processReconstructionCallback(
  gpuJobId: string,
  uploadedFiles: Express.Multer.File[],
  callbackMetadata: any
): Promise<ReconstructionCallbackResult> {
  try {
    logger.info(`${serviceLocation}: Processing 4D reconstruction callback for job ${gpuJobId}`);

    // Extract GPU result data
    const { status, result: gpuResult, error: gpuErrorDetail } = callbackMetadata;

    if (status !== "completed" && status !== "success") {
      return {
        success: false,
        message: `GPU job completed with status: ${status}`,
        error: gpuErrorDetail
      };
    }

    // Validate uploaded OBJ files
    const validationResult = validateObjFiles(uploadedFiles, gpuJobId);
    if (!validationResult.success) {
      return validationResult;
    }

    // Process OBJ files
    const processedFiles = await processObjFiles(uploadedFiles, gpuJobId);
    
    // Get project details for userId and filehash
    const { userId, filehash, projectId } = await getProjectDetails(gpuJobId);
    
    // Create TAR bundle
    const tarResult = await createReconstructionTar(processedFiles, userId, filehash, gpuJobId);
    if (!tarResult.success) {
      return tarResult;
    }

    // Upload TAR to S3 using same structure as project files
    let reconstructionFileS3Url: string;
    try {
      const tarStream = fsSync.createReadStream(tarResult.tarPath!);
      const s3KeyPrefix = `source_nifti/${userId}/`;  // Same as project files
      
      reconstructionFileS3Url = await uploadToS3(
        tarStream,
        userId,
        filehash,
        '.tar',
        s3KeyPrefix
      );
      
      logger.info(`${serviceLocation}: Successfully uploaded reconstruction TAR to S3: ${reconstructionFileS3Url}`);
    } catch (error) {
      logger.error(`${serviceLocation}: Failed to upload reconstruction TAR to S3:`, error);
      return {
        success: false,
        message: `S3 upload failed: ${(error as Error).message}`
      };
    }

    // Create database reconstruction record
    const dbResult = await createReconstructionRecord(
      gpuJobId,
      projectId,
      userId,
      filehash,
      gpuResult,
      processedFiles,
      tarResult.tarSize!,
      reconstructionFileS3Url
    );
    if (!dbResult.success) {
      return dbResult;
    }

    // Update job status
    await updateJobWithReconstructionData(gpuJobId, tarResult.tarPath!);

    // Cleanup temporary files
    await cleanupTempFiles(processedFiles, tarResult.tarPath!);

    logger.info(`${serviceLocation}: Successfully processed reconstruction for job ${gpuJobId}`);
    return {
      success: true,
      message: "4D reconstruction processed successfully",
      reconstructionId: dbResult.reconstructionId
    };

  } catch (error) {
    LogError(
      error as Error,
      serviceLocation,
      `Unexpected error processing reconstruction callback for job ${gpuJobId}`
    );
    return {
      success: false,
      message: "Unexpected error occurred during reconstruction processing",
      error: (error as Error).message
    };
  }
}

/**
 * Validate uploaded OBJ files
 */
function validateObjFiles(
  uploadedFiles: Express.Multer.File[],
  gpuJobId: string
): ReconstructionCallbackResult {
  if (!uploadedFiles || uploadedFiles.length === 0) {
    logger.error(`${serviceLocation}: No OBJ files received for job ${gpuJobId}`);
    return {
      success: false,
      message: "No OBJ files received in reconstruction callback"
    };
  }

  const invalidFiles = uploadedFiles.filter(file => 
    !file.originalname.toLowerCase().endsWith('.obj')
  );
  
  if (invalidFiles.length > 0) {
    logger.error(`${serviceLocation}: Invalid file formats for job ${gpuJobId}: ${invalidFiles.map(f => f.originalname).join(', ')}`);
    return {
      success: false,
      message: `Invalid file formats. Expected .obj files, received: ${invalidFiles.map(f => f.originalname).join(', ')}`
    };
  }

  logger.info(`${serviceLocation}: Valid OBJ files received for job ${gpuJobId}. Count: ${uploadedFiles.length}, Total size: ${uploadedFiles.reduce((sum, f) => sum + f.size, 0)} bytes`);
  return { success: true, message: "Files validated successfully" };
}

/**
 * Process uploaded OBJ files and extract metadata
 */
async function processObjFiles(
  uploadedFiles: Express.Multer.File[],
  gpuJobId: string
): Promise<ProcessedObjFile[]> {
  const processedFiles: ProcessedObjFile[] = [];
  
  logger.info(`${serviceLocation}: Processing ${uploadedFiles.length} OBJ files for job ${gpuJobId}`);
  
  for (const file of uploadedFiles) {
    // Extract frame index from filename if present (e.g., frame_001.obj, heart_frame_2.obj)
    const frameMatch = file.originalname.match(/frame[_-]?(\d+)/i);
    const frameIndex = frameMatch ? parseInt(frameMatch[1], 10) : undefined;
    
    processedFiles.push({
      filename: file.filename,
      originalName: file.originalname,
      tempPath: file.path,
      size: file.size,
      frameIndex: frameIndex,
    });
    
    logger.info(`${serviceLocation}: Processed OBJ file ${file.originalname} (${file.size} bytes)${frameIndex !== undefined ? ` for frame ${frameIndex}` : ' with no frame info'}`);
  }
  
  logger.info(`${serviceLocation}: Successfully processed ${processedFiles.length} OBJ files for job ${gpuJobId}`);
  return processedFiles;
}

/**
 * Get project details (userId, filehash, projectId) from job
 */
async function getProjectDetails(gpuJobId: string): Promise<{ userId: string; filehash: string; projectId: string }> {
  // Get job details first
  const { readJob } = await import("./database");
  const jobResult = await readJob(gpuJobId);
  
  if (!jobResult.success || !jobResult.job) {
    throw new Error(`Job ${gpuJobId} not found`);
  }
  
  const projectId = jobResult.job.projectid;
  
  // Get project details
  const projectResult = await readProject(projectId);
  if (!projectResult.success || !projectResult.project) {
    throw new Error(`Project ${projectId} not found for job ${gpuJobId}`);
  }

  const userId = projectResult.project.userid;
  const filehash = projectResult.project.filehash;

  if (!userId || !filehash) {
    throw new Error(`Missing userId (${userId}) or filehash (${filehash}) for job ${gpuJobId}`);
  }

  logger.info(`${serviceLocation}: Retrieved project details for job ${gpuJobId} - userId: ${userId}, filehash: ${filehash.substring(0, 10)}...`);
  return { userId, filehash, projectId };
}

/**
 * Create TAR bundle from OBJ files following naming convention
 */
async function createReconstructionTar(
  processedFiles: ProcessedObjFile[],
  userId: string,
  filehash: string,
  gpuJobId: string
): Promise<{ success: boolean; message: string; tarPath?: string; tarSize?: number }> {
  try {
    // Use consistent naming pattern: {userId}_{filehash}_mesh.tar
    const tarFilename = `${userId}_${filehash}_mesh.tar`;
    const tarPath = path.join("src/temp_mesh/", tarFilename);
    
    logger.info(`${serviceLocation}: Creating TAR bundle: ${tarFilename} with ${processedFiles.length} OBJ files`);
    
    // Ensure temp_mesh directory exists
    await fs.mkdir("src/temp_mesh/", { recursive: true });
    
    // Build TAR command with all OBJ files
    const objFileNames = processedFiles.map(f => path.basename(f.tempPath));
    const tarCommand = `tar -cf "${tarPath}" -C "src/temp_mesh/" ${objFileNames.map(name => `"${name}"`).join(' ')}`;
    
    logger.info(`${serviceLocation}: Executing TAR command: ${tarCommand}`);
    execSync(tarCommand, { stdio: 'pipe' });
    
    // Get TAR file size and validate
    const tarBuffer = await fs.readFile(tarPath);
    const tarSize = tarBuffer.length;
    
    if (tarSize === 0) {
      throw new Error('TAR file created but is empty (0 bytes)');
    }
    
    logger.info(`${serviceLocation}: TAR bundle created successfully: ${tarFilename} (${tarSize} bytes, using project filehash: ${filehash.substring(0, 16)}...)`);
    
    return {
      success: true,
      message: "TAR bundle created successfully",
      tarPath,
      tarSize
    };
    
  } catch (error) {
    logger.error(`${serviceLocation}: Failed to create TAR bundle for job ${gpuJobId}:`, error);
    return {
      success: false,
      message: `Failed to create required TAR bundle: ${(error as Error).message}`
    };
  }
}

/**
 * Create reconstruction database record
 */
async function createReconstructionRecord(
  gpuJobId: string,
  projectId: string,
  userId: string,
  filehash: string,
  gpuResult: any,
  processedFiles: ProcessedObjFile[],
  tarSize: number,
  reconstructionFileS3Url: string
): Promise<{ success: boolean; message: string; reconstructionId?: string }> {
  try {
    // Extract GPU metadata
    const edFrameIndex = gpuResult.ed_frame_index !== undefined ? gpuResult.ed_frame_index : 0;
    const totalFrames = gpuResult.total_frames || 1;
    
    // Generate reconstruction details
    const reconstructionName = `4D Reconstruction - Job ${gpuJobId.substring(0, 8)}`;
    const reconstructionDescription = `4D cardiac reconstruction: ${processedFiles.length} frames, ED frame ${edFrameIndex + 1}`;
    const finalFilename = `${userId}_${filehash}_mesh.tar`;
    
    // Generate basepath following same pattern as projects
    const s3KeyPrefix = `source_nifti/${userId}/`;
    const basepath = `s3://${process.env.AWS_BUCKET_NAME}/${s3KeyPrefix}`;
    
    const reconstructionData: Partial<IProjectReconstruction> = {
      projectid: projectId,
      name: reconstructionName,
      description: reconstructionDescription,
      ed_frame: edFrameIndex + 1,
      isSaved: false,
      isAIGenerated: true,
      meshFormat: MeshFormat.OBJ,
      filename: finalFilename,
      filesize: tarSize,
      filehash: filehash,
      basepath: basepath,
      reconstructionfolderpath: reconstructionFileS3Url,
      reconstructedMesh: {
        path: reconstructionFileS3Url,
        filename: finalFilename,
        filesize: tarSize,
        hash: filehash,
        format: "tar",
        reconstructionTime: gpuResult.reconstruction_time,
        numIterations: gpuResult.num_iterations,
        resolution: gpuResult.resolution
      },
    };

    const createResult = await createProjectReconstruction(reconstructionData as IProjectReconstruction);

    if (createResult.success && createResult.projectreconstruction) {
      logger.info(`${serviceLocation}: Successfully created reconstruction ${createResult.projectreconstruction._id} for project ${projectId}`);
      return {
        success: true,
        message: "Reconstruction record created successfully",
        reconstructionId: createResult.projectreconstruction._id.toString()
      };
    } else {
      logger.error(`${serviceLocation}: Failed to create reconstruction record for job ${gpuJobId}: ${createResult.message}`);
      return {
        success: false,
        message: `Failed to create reconstruction record: ${createResult.message}`
      };
    }
  } catch (error) {
    logger.error(`${serviceLocation}: Error creating reconstruction record for job ${gpuJobId}:`, error);
    return {
      success: false,
      message: `Database error: ${(error as Error).message}`
    };
  }
}

/**
 * Update job with reconstruction completion data
 */
async function updateJobWithReconstructionData(gpuJobId: string, tarPath: string): Promise<void> {
  try {
    await updateJob(gpuJobId, {
      result: JSON.stringify({
        reconstruction_created: true,
        tar_file_path: path.basename(tarPath),
        ready_for_s3_upload: true
      }),
    });
    logger.info(`${serviceLocation}: Updated job ${gpuJobId} with reconstruction data`);
  } catch (error) {
    logger.warn(`${serviceLocation}: Failed to update job ${gpuJobId} with reconstruction data:`, error);
    // Don't fail the whole process for job update issues
  }
}

/**
 * Cleanup temporary files
 */
async function cleanupTempFiles(processedFiles: ProcessedObjFile[], tarPath: string): Promise<void> {
  try {
    // Clean up individual OBJ files
    for (const objFile of processedFiles) {
      try {
        await fs.unlink(objFile.tempPath);
        logger.debug(`${serviceLocation}: Cleaned up temporary OBJ file: ${objFile.tempPath}`);
      } catch (fileError) {
        logger.warn(`${serviceLocation}: Failed to delete temporary file ${objFile.tempPath}:`, fileError);
      }
    }
    
    // Clean up TAR file
    if (tarPath) {
      try {
        await fs.unlink(tarPath);
        logger.debug(`${serviceLocation}: Cleaned up TAR bundle: ${tarPath}`);
      } catch (tarError) {
        logger.warn(`${serviceLocation}: Failed to delete TAR file ${tarPath}:`, tarError);
      }
    }
    
    logger.info(`${serviceLocation}: Cleaned up ${processedFiles.length} OBJ files and TAR bundle`);
  } catch (cleanupError) {
    logger.warn(`${serviceLocation}: Failed to cleanup temporary files:`, cleanupError);
    // Don't fail the whole process due to cleanup issues
  }
}