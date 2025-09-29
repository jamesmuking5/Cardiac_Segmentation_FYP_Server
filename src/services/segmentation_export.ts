// File: src/services/segmentation_export.ts
// Description: Service layer for segmentation NIfTI export functionality - extracted from routes for reuse.

import { IProjectSegmentationMask, IProjectDocument } from "../types/database_types";
import { readProject, readProjectSegmentationMask } from "./database";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { uploadMaskToS3, downloadFromS3, extractS3KeyFromUrl } from "./s3_handler";
import logger from "./logger";
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const serviceLocation = 'SegmentationExport';

/**
 * Generates a segmentation NIfTI file specifically for 4D reconstruction
 * Only uses AI-generated masks (MedSAM output) for consistency with GPU processing
 * 
 * @param projectId - The project ID to generate segmentation NIfTI for
 * @param userId - The user ID (for access validation)
 * @returns Promise with success status, S3 URL, and metadata
 */
export const generateAISegmentationForReconstruction = async (
    projectId: string, 
    userId?: string
): Promise<{ 
    success: boolean; 
    message?: string; 
    s3Url?: string; 
    fileSizeBytes?: number;
    s3Key?: string;
}> => {
    const tempExportId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', tempExportId);
    const segmentationsJsonPath = path.join(baseTempDir, 'segmentations.json');
    const localOutputSegmentationNiftiPath = path.join(baseTempDir, `reconstruction_${tempExportId}.nii.gz`);

    logger.info(`${serviceLocation}: Starting AI segmentation NIfTI generation for reconstruction - Project: ${projectId}, Temp ID: ${tempExportId}`);

    try {
        const s3BucketName = process.env.AWS_BUCKET_NAME;
        if (!s3BucketName) {
            return { success: false, message: "AWS S3 bucket configuration is missing." };
        }

        await fs.ensureDir(baseTempDir);

        // 1. Validate AI segmentation masks exist
        const hasMasksResult = await readProjectSegmentationMask(projectId);
        if (!hasMasksResult.projectsegmentationmasks || hasMasksResult.projectsegmentationmasks.length === 0) {
            return { success: false, message: "No segmentation masks found. Run AI segmentation first for reconstruction." };
        }

        // 2. Read Project Details (including dimensions and original NIfTI path)
        const projectResult = await readProject(projectId, userId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access.`);
            return { success: false, message: "Project not found or access denied." };
        }
        
        const project: IProjectDocument = projectResult.projects[0];

        if (!project.dimensions || project.dimensions.width == null || project.dimensions.height == null) {
            logger.error(`${serviceLocation}: Project ${projectId} is missing critical dimension data (width/height).`);
            return { success: false, message: "Project is missing critical dimension data." };
        }

        const planeHeightForRLE = project.dimensions.height;
        const planeWidthForRLE = project.dimensions.width;

        // 3. Select ONLY AI-generated masks (MedSAM output) for reconstruction
        let segmentationsToProcess: IProjectSegmentationMask[] = [];

        const aiMask = hasMasksResult.projectsegmentationmasks!.find(mask => mask.isMedSAMOutput === true);
        if (aiMask) {
            logger.info(`${serviceLocation}: Found AI segmentation mask for reconstruction of project ${projectId}. Using MedSAM output.`);
            segmentationsToProcess = [aiMask];
        } else {
            logger.error(`${serviceLocation}: No AI-generated segmentation mask found for reconstruction of project ${projectId}. Reconstruction requires MedSAM output.`);
            return { success: false, message: "No AI-generated segmentation mask available for reconstruction. Please run AI segmentation first." };
        }

        await fs.writeJson(segmentationsJsonPath, segmentationsToProcess, { spaces: 2 });
        logger.info(`${serviceLocation}: Created segmentations.json for reconstruction of project ${projectId}`);

        // 4. Generate NIfTI using Python script
        let pythonScriptPath: string;
        let pythonCommand: string;

        if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
            // Use stored affine matrix approach (no download needed)
            logger.info(`${serviceLocation}: Using stored affine matrix for reconstruction of project ${projectId}`);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');

            const affineMatrixFile = path.join(baseTempDir, 'affine_matrix.json');
            const dimensionsFile = path.join(baseTempDir, 'dimensions.json');

            await fs.writeJson(affineMatrixFile, project.affineMatrix, { spaces: 2 });
            await fs.writeJson(dimensionsFile, project.dimensions, { spaces: 2 });

            pythonCommand = `python "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" ${planeWidthForRLE} ${planeHeightForRLE} "${affineMatrixFile}" "${dimensionsFile}"`;
        } else {
            // Use download and extract approach (legacy)
            logger.info(`${serviceLocation}: No stored affine matrix found for reconstruction of project ${projectId}. Using download approach.`);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_segmentation.py');
            const s3Url = project.extractedfolderpath;

            if (!s3Url) {
                return { success: false, message: "Project has no associated S3 file path." };
            }

            pythonCommand = `python "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" ${planeWidthForRLE} ${planeHeightForRLE} "${s3Url}"`;
        }

        logger.info(`${serviceLocation}: Executing Python script for reconstruction NIfTI generation of project ${projectId}`);
        logger.debug(`${serviceLocation}: Python command: ${pythonCommand}`);

        const pythonResult = await new Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>((resolve) => {
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`${serviceLocation}: Python script execution failed for reconstruction of project ${projectId}: ${error.message}`);
                    resolve({ success: false, error: error.message, stderr });
                } else {
                    logger.info(`${serviceLocation}: Python script completed successfully for reconstruction of project ${projectId}`);
                    resolve({ success: true, stdout, stderr });
                }
            });
        });

        if (!pythonResult.success) {
            return { success: false, message: `NIfTI generation failed for reconstruction: ${pythonResult.error}` };
        }

        // 5. Check if the output file was created
        const outputExists = await fs.pathExists(localOutputSegmentationNiftiPath);
        if (!outputExists) {
            logger.error(`${serviceLocation}: Expected NIfTI output file not created for reconstruction of project ${projectId}: ${localOutputSegmentationNiftiPath}`);
            return { success: false, message: "NIfTI file was not generated successfully for reconstruction." };
        }

        const fileStats = await fs.stat(localOutputSegmentationNiftiPath);
        logger.info(`${serviceLocation}: Successfully generated reconstruction NIfTI for project ${projectId}. File size: ${fileStats.size} bytes`);

        // 6. Upload to S3
        const fileStream = fs.createReadStream(localOutputSegmentationNiftiPath);
        const s3Key = await uploadMaskToS3(
            fileStream,
            userId || 'system',
            tempExportId,
            '.nii.gz',
            'reconstruction_nifti/',
            `reconstruction_${projectId}_${tempExportId}.nii.gz`
        );

        logger.info(`${serviceLocation}: Successfully uploaded reconstruction NIfTI to S3 for project ${projectId}. S3 Key: ${s3Key}`);

        // 7. Generate presigned URL (optional, for debugging)
        const presignedUrl = await generatePresignedGetUrl(s3BucketName, s3Key, 3600);
        
        return {
            success: true,
            message: "AI segmentation NIfTI generated successfully for reconstruction.",
            s3Key: s3Key,
            s3Url: presignedUrl || undefined,
            fileSizeBytes: fileStats.size
        };

    } catch (error: any) {
        logger.error(`${serviceLocation}: Error generating AI segmentation NIfTI for reconstruction of project ${projectId}:`, error);
        return { success: false, message: `Error generating AI segmentation NIfTI for reconstruction: ${error.message}` };
    } finally {
        // Cleanup temporary directory
        if (await fs.pathExists(baseTempDir)) {
            logger.info(`${serviceLocation}: Cleaning up temporary directory for reconstruction of project ${projectId}`);
            await fs.remove(baseTempDir);
        }
    }
};