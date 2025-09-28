// File: src/services/reconstruction.ts
// Description: Service layer for initiating 4D reconstruction process, including Cloud GPU communication.

import { IUserSafe, ProjectCrudResult } from "../types/database_types";
import logger from "./logger";
import { readProject } from "./database";
import { v4 as uuidv4 } from 'uuid';
import { createJob, IJob, JobStatus, updateJob } from "../services/database";
import axios from 'axios';
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { URL } from 'url';  // ADDED URL import for S3 URL parsing
import { getFreshGPUServerAddress, getCurrentToken } from "./gpu_auth_client";

const serviceLocation = 'Reconstruction';

const sendReconstructionRequestToCloudGpu = async (
    reconstructionData: {
        url: string;  
        uuid: string;
        callback_url: string;
        ed_frame_index: number; 
        num_iterations?: number;  
        resolution?: number;
        process_all_frames?: boolean;
        debug_save?: boolean;    
        debug_dir?: string;
    },
    gpuAuthToken: string
): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    // Get fresh GPU server configuration from database
    const cloudGpuBaseUrl = await getFreshGPUServerAddress();
    if (!cloudGpuBaseUrl) {
        logger.info(`${serviceLocation}: Currently configured Cloud GPU URL: ${cloudGpuBaseUrl}`);
        logger.error(`${serviceLocation}: GPU server configuration is not available from database.`);
        return { success: false, error: "Cloud GPU URL not configured." };
    }

    // For debugging: Log the token being used. Mask or remove in production.
    logger.debug(`${serviceLocation}: Attempting to send 4D reconstruction request. Token (first 10 chars): ${gpuAuthToken ? gpuAuthToken.substring(0, 10) + "..." : "undefined"}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send 4D reconstruction request to Cloud GPU.`);
        return { success: false, error: "Authentication token for Cloud GPU is missing." };
    }

    const reconstructionEndpoint = `${cloudGpuBaseUrl}/inference/v2/4d-reconstruction`;

    try {
        const response = await axios.post(reconstructionEndpoint, reconstructionData, {
            headers: {
                Authorization: `Bearer ${gpuAuthToken}`,
                'Content-Type': 'application/json',
                'X-Job-ID': reconstructionData.uuid
            },
            timeout: 120000, // 2 minute timeout for request submission
        });

        // Log the full response data for debugging
        logger.info(`${serviceLocation}: Successfully received response from Cloud GPU for UUID ${reconstructionData.uuid}. Status: ${response.status}, Full Response Data:`, response.data);

        // Attempt to extract a job ID from common fields
        interface ReconstructionResponse {
            job_id?: string;
            jobId?: string;
            uuid?: string;
            [key: string]: any; // Allow additional properties if needed
        }

        const responseData = response.data as ReconstructionResponse;
        const returnedJobId = responseData.job_id || responseData.jobId || responseData.uuid;

        if (response.status === 202 && response.data) {
            if (returnedJobId) {
                logger.info(`${serviceLocation}: GPU Job ID identified: ${returnedJobId} for local UUID ${reconstructionData.uuid}.`);
                return { success: true, jobId: returnedJobId };
            } else {
                logger.warn(`${serviceLocation}: GPU request successful (Status ${response.status}) for UUID ${reconstructionData.uuid}, but no clear Job ID found in response. Response data logged above.`);
                return { success: true, jobId: reconstructionData.uuid }; // Fallback to internal UUID
            }
        } else {
            const gpuError = response.data?.error || `Cloud GPU responded with status ${response.status}.`;
            logger.error(`${serviceLocation}: Error from Cloud GPU: ${gpuError}`, response.data);
            return { success: false, error: `Cloud GPU error: ${gpuError}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error sending 4D reconstruction request to ${reconstructionEndpoint}: ${error.message}`, { error });
        let errorMessage = `Error communicating with Cloud GPU: ${error.message}`;
        if (error.response?.status) {
            errorMessage += ` (Status: ${error.response.status})`;
        }
        return { success: false, error: errorMessage };
    }
};

export const startReconstruction = async (projectId: string, user?: IUserSafe, reconstructionName?: string, reconstructionDescription?: string, parameters?: any, ed_frame?: number): Promise<{ success: boolean; message: string; uuid?: string }> => {
    logger.info(`${serviceLocation}: Received start 4D reconstruction request for project ${projectId} with ed_frame ${ed_frame} by user ${user?.username} with id ${user?._id}`);
    
    const gpuAuthToken = getCurrentToken();
    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start 4D reconstruction.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start 4D reconstruction." };
    }
    
    const callback_url = process.env.CALLBACK_URL;
    if (!callback_url) {
        logger.error(`${serviceLocation}: CALLBACK_URL is not set in environment variables. Cannot start reconstruction for project ${projectId}.`);
        return { success: false, message: "Callback URL not configured for reconstruction." };
    }

    const s3BucketName = process.env.AWS_BUCKET_NAME;
    if (!s3BucketName) {
        logger.error(`${serviceLocation}: AWS_BUCKET_NAME is not set in environment variables. Cannot start reconstruction for project ${projectId}.`);
        return { success: false, message: "S3 bucket configuration is missing." };
    }

    try {
        // Validate project exists and user has access
        const projectResult: ProjectCrudResult = await readProject(projectId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project with ID ${projectId} not found or error reading project.`);
            return { success: false, message: `Project with ID ${projectId} not found.` };
        }

        const projectData = projectResult.projects[0];

        if (projectData.userid !== user?._id) {
            logger.warn(`${serviceLocation}: User ${user?._id} denied access to project ${projectId} for 4D reconstruction.`);
            return { success: false, message: "Access denied to this project" };
        }

        // Validate ed_frame parameter if provided
        if (ed_frame !== undefined) {
            if (!Number.isInteger(ed_frame) || ed_frame < 1) {
                logger.warn(`${serviceLocation}: Invalid ed_frame value ${ed_frame} for project ${projectId}. Must be a positive integer >= 1.`);
                return { success: false, message: `Invalid end-diastole frame number: ${ed_frame}. Must be a positive integer >= 1.` };
            }
            
            // Optional: Validate against actual project frame count if available
            if (projectData.dimensions?.frames && ed_frame > projectData.dimensions.frames) {
                logger.warn(`${serviceLocation}: ed_frame ${ed_frame} exceeds project ${projectId} frame count of ${projectData.dimensions.frames}.`);
                return { success: false, message: `End-diastole frame ${ed_frame} exceeds project frame count of ${projectData.dimensions.frames}.` };
            }
        }

        // Extract S3 object key from the originalfilepath URL for NIfTI file 
        const niftiS3Url = projectData.originalfilepath;
        let objectKeyForNifti: string;
        try {
            const parsedUrl = new URL(niftiS3Url);
            objectKeyForNifti = parsedUrl.pathname;
            if (objectKeyForNifti.startsWith('/')) {
                objectKeyForNifti = objectKeyForNifti.substring(1);
            }
        } catch (e: any) {
            logger.error(`${serviceLocation}: Invalid S3 URL format for NIfTI file: ${niftiS3Url}`, e);
            return { success: false, message: `Invalid NIfTI file URL format: ${e.message}` };
        }

        if (!objectKeyForNifti) {
            logger.error(`${serviceLocation}: Could not extract S3 object key from NIfTI file URL: ${niftiS3Url}`);
            return { success: false, message: "Failed to determine S3 object key for NIfTI file." };
        }

        // Get presigned URL for the NIfTI file
        const dataUrlForGpu = await generatePresignedGetUrl(s3BucketName, objectKeyForNifti, 3600);
        if (!dataUrlForGpu) {
            logger.error(`${serviceLocation}: Failed to generate presigned S3 URL for project ${projectId}, NIfTI S3 Key: ${objectKeyForNifti}`);
            return { success: false, message: "Failed to prepare TAR file URL for inference." };
        }

        // Generate job UUID
        const jobUuid = uuidv4();

        // Prepare reconstruction request payload - match GPU server schema
        const reconstructionPayload = {
            url: dataUrlForGpu,  // Presigned URL for segmentation data
            uuid: jobUuid,
            callback_url: callback_url,  
            ed_frame_index: (ed_frame || 1) - 1,  // Convert 1-based ed_frame to 0-based ed_frame_index for GPU
            num_iterations: parameters?.num_iterations || 50,  // Flattened parameters
            resolution: parameters?.resolution || 128,
            process_all_frames: parameters?.process_all_frames ?? true,  // Enable 4D processing by default
            debug_save: parameters?.debug_save || parameters?.debug || false,  // Support both debug and debug_save
            debug_dir: parameters?.debug_dir || "/tmp/4d_reconstruction_debug"
        };

        // The logger in sendReconstructionRequestToCloudGpu will log the full payload.
        logger.info(`${serviceLocation}: Prepared reconstruction data for project ${projectId}, UUID ${jobUuid}, ed_frame_index ${reconstructionPayload.ed_frame_index} (converted from ed_frame ${ed_frame || 1}), 4D processing: ${reconstructionPayload.process_all_frames}. NIfTI S3 Key: ${objectKeyForNifti}. Callback URL: ${reconstructionPayload.callback_url}`);

        // Send reconstruction request to GPU server BEFORE creating job record
        const reconstructionResult = await sendReconstructionRequestToCloudGpu(reconstructionPayload, gpuAuthToken);

        if (reconstructionResult.success && reconstructionResult.jobId) {
            logger.info(`${serviceLocation}: Reconstruction request sent successfully for project ${projectId}. GPU Job ID: ${reconstructionResult.jobId}, Local UUID: ${jobUuid}.`);

            // Create job record AFTER successful GPU submission
            const jobData: Partial<IJob> = {
                userid: user?._id,
                projectid: projectId,
                uuid: jobUuid,
                status: JobStatus.PENDING,  // Set to PENDING since GPU already accepted
                result: `GPU Job ID: ${reconstructionResult.jobId}`,
                message: "4D reconstruction submitted to GPU server",
                segmentationName: reconstructionName || `4D Reconstruction - ${new Date().toISOString()}`,
                segmentationDescription: reconstructionDescription || "4D cardiac reconstruction using SDF model"
            };

            const jobCreationResult = await createJob(jobData as IJob);

            if (jobCreationResult.success) {
                return { success: true, message: `4D reconstruction job accepted. UUID: ${jobUuid}`, uuid: jobUuid };
            } else {
                logger.error(`${serviceLocation}: Failed to create job record for ${jobUuid}: ${jobCreationResult.message || 'Unknown error'}`);
                return { success: true, message: `4D reconstruction accepted by GPU (Job ID: ${reconstructionResult.jobId}), but failed to track job locally. UUID: ${jobUuid}`, uuid: jobUuid };
            }
        } else if (reconstructionResult.success) {
            logger.warn(`${serviceLocation}: 4D reconstruction request reported success for project ${projectId} but no definite Job ID was returned from GPU. Local UUID: ${jobUuid}`);
            return { success: true, message: `4D reconstruction request sent for project ${projectId}, but no Job ID was clearly identified from GPU. UUID: ${jobUuid}`, uuid: jobUuid };
        } else {
            logger.error(`${serviceLocation}: Failed to send 4D reconstruction request for project ${projectId}: ${reconstructionResult.error}`);
            return { success: false, message: `Failed to start 4D reconstruction: ${reconstructionResult.error}` };
        }

    } catch (error: any) {
        logger.error(`${serviceLocation}: Critical error starting 4D reconstruction for project ${projectId}:`, error);
        return { success: false, message: `Error starting 4D reconstruction: ${error.message}` };
    }
};