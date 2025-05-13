// File: src/services/inference.ts
// Description: Service layer for initiating the inference process, including Cloud GPU communication.

import { IUserSafe, ProjectCrudResult } from "../types/database_types";
import logger from "./logger";
import { readProject } from "./database";
import { v4 as uuidv4 } from 'uuid';
import { createJob, IJob, JobStatus } from "../services/database";
import axios from 'axios';
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";

const serviceLocation = "Inference";
const cloudGpuBaseUrl = process.env.CLOUD_GPU_URL_AND_PORT;

const sendInferenceRequestToCloudGpu = async (inferenceData: any, gpuAuthToken: string): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    if (!cloudGpuBaseUrl) {
        logger.error(`${serviceLocation}: CLOUD_GPU_URL_AND_PORT is not set in environment variables.`);
        return { success: false, error: "Cloud GPU URL not configured." };
    }

    // For debugging: Log the token being used. Mask or remove in production.
    logger.debug(`${serviceLocation}: Attempting to send inference request. Token (first 10 chars): ${gpuAuthToken ? gpuAuthToken.substring(0, 10) + "..." : "undefined"}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send inference request to Cloud GPU.`);
        return { success: false, error: "Authentication token for Cloud GPU is missing." };
    }

    const inferenceEndpoint = `${cloudGpuBaseUrl}/inference/v2/medsam-inference`; // Adjust the endpoint as needed

    try {
        const response = await axios.post(inferenceEndpoint, inferenceData, {
            headers: {
                Authorization: `Bearer ${gpuAuthToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 120000, // e.g., 2 minutes, adjust as needed
        });

        // **** THIS IS WHERE YOU LOG THE GPU SERVER'S RESPONSE DATA ****
        // The existing logger.info call here should already be doing this.
        // We log the full response.data object.
        logger.info(`${serviceLocation}: Successfully received response from Cloud GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Full Response Data:`, response.data);

        // Attempt to extract a job ID from common fields
        // Adjust these fields (job_id, jobId, uuid) based on what your GPU server actually returns
        interface InferenceResponse {
            job_id?: string;
            jobId?: string;
            uuid?: string;
            [key: string]: any; // Allow additional properties if needed
        }

        const responseData = response.data as InferenceResponse;
        const returnedJobId = responseData.job_id || responseData.jobId || responseData.uuid;

        if (response.status === 202 && response.data) { // Or other success statuses like 200, 201
            if (returnedJobId) {
                logger.info(`${serviceLocation}: GPU Job ID identified: ${returnedJobId} for local UUID ${inferenceData.uuid}.`);
                return { success: true, jobId: returnedJobId };
            } else {
                logger.warn(`${serviceLocation}: GPU request successful (Status ${response.status}) for UUID ${inferenceData.uuid}, but no clear Job ID found in response. Response data logged above.`);
                // Decide if this is still a success for your workflow.
                // You might still return success and use your internal UUID if the GPU doesn't provide one.
                return { success: true, jobId: inferenceData.uuid }; // Fallback to internal UUID if no external one
            }
        } else {
            // Handle cases where status might be 2xx but data is not as expected, or status is not 202
            logger.error(`${serviceLocation}: Unexpected successful response from Cloud GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Data:`, response.data);
            return { success: false, error: `Cloud GPU responded with status ${response.status} but data was unexpected: ${JSON.stringify(response.data)}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error sending inference request to ${inferenceEndpoint}: ${error.message}`, { error });
        let errorMessage = `Error communicating with Cloud GPU: ${error.message}`;
        if (error.response?.status) {
            errorMessage += ` (Status: ${error.response.status})`;
        }
        return { success: false, error: errorMessage };
    }
};
export const startInference = async (projectId: string, user?: IUserSafe, gpuAuthToken?: string): Promise<{ success: boolean; message: string; uuid?: string }> => {
    logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${user?.username} with id ${user?._id}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start inference.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start inference." };
    }

    const callback_url = process.env.CALLBACK_URL;
    if (!callback_url) {
        logger.error(`${serviceLocation}: CALLBACK_URL is not set in environment variables. Cannot start inference for project ${projectId}.`);
        return { success: false, message: "Callback URL not configured for inference." };
    }

    const s3BucketName = process.env.AWS_BUCKET_NAME;
    if (!s3BucketName) {
        logger.error(`${serviceLocation}: AWS_BUCKET_NAME is not set in environment variables. Cannot start inference for project ${projectId}.`);
        return { success: false, message: "S3 bucket configuration is missing." };
    }

    try {
        const projectResult: ProjectCrudResult = await readProject(projectId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project with ID ${projectId} not found or error reading project.`);
            return { success: false, message: `Project with ID ${projectId} not found.` };
        }

        const projectData = projectResult.projects[0]; // Access the first (and likely only) project in the array

        // Use extractedfolderpath which should be the S3 URL of the .tar file
        const s3HttpsUrlForTar = projectData.extractedfolderpath;
        if (!s3HttpsUrlForTar) {
            logger.error(`${serviceLocation}: Project ${projectId} does not have an extractedfolderpath (URL for the .tar file).`);
            return { success: false, message: "Project TAR file URL is missing." };
        }

        let objectKeyForTar: string;
        try {
            const parsedUrl = new URL(s3HttpsUrlForTar);
            objectKeyForTar = parsedUrl.pathname;
            if (objectKeyForTar.startsWith('/')) {
                objectKeyForTar = objectKeyForTar.substring(1); // Remove leading slash
            }
            // This parsing assumes virtual-hosted style S3 URLs (bucket.s3.region...)
            // If your S3 URLs are path-style (s3.region.amazonaws.com/bucket/key),
            // and the bucket name is part of the pathname, you might need to adjust.
            // However, uploadToS3 in uploadmiddleware.ts likely generates virtual-hosted URLs.
        } catch (e: any) {
            logger.error(`${serviceLocation}: Invalid S3 URL format in project.extractedfolderpath: ${s3HttpsUrlForTar}`, e);
            return { success: false, message: `Invalid project TAR file URL format: ${e.message}` };
        }

        if (!objectKeyForTar) {
            logger.error(`${serviceLocation}: Could not extract S3 object key from TAR file URL: ${s3HttpsUrlForTar}`);
            return { success: false, message: "Failed to determine S3 object key for TAR file." };
        }

        // Generate presigned URL for the .tar file
        const dataUrlForGpu = await generatePresignedGetUrl(s3BucketName, objectKeyForTar);

        if (!dataUrlForGpu) {
            logger.error(`${serviceLocation}: Failed to generate presigned S3 URL for project ${projectId}, TAR S3 Key: ${objectKeyForTar}`);
            return { success: false, message: "Failed to prepare TAR file URL for inference." };
        }

        const jobUuid = uuidv4();

        // CRITICAL: Ensure this payload matches exactly what your GPU server expects
        const inferenceData = {
            uuid: jobUuid,
            callback_url: callback_url,
            url: dataUrlForGpu, // This is now the presigned URL
        };

        // The logger in sendInferenceRequestToCloudGpu will log the full payload.
        // You can add a summary log here if preferred:
        logger.info(`${serviceLocation}: Prepared inference data for project ${projectId}, UUID ${jobUuid}. TAR S3 Key: ${objectKeyForTar}`);

        const inferenceResult = await sendInferenceRequestToCloudGpu(inferenceData, gpuAuthToken);

        if (inferenceResult.success && inferenceResult.jobId) { // Check for jobId from GPU
            logger.info(`${serviceLocation}: Inference request sent successfully for project ${projectId}. GPU Job ID: ${inferenceResult.jobId}, Local UUID: ${jobUuid}.`);

            const jobData: IJob = {
                userid: user?._id?.toString() || 'unknown',
                projectid: projectId,
                uuid: jobUuid, // Our internal UUID
                status: JobStatus.PENDING, // Or IN_PROGRESS if GPU confirms immediate start
            };
            const jobCreationResult = await createJob(jobData);

            if (jobCreationResult.success) {
                return { success: true, message: `Inference job accepted. UUID: ${jobUuid}`, uuid: jobUuid };
            } else {
                logger.error(`${serviceLocation}: Failed to create job record for ${jobUuid}: ${jobCreationResult.message || 'Unknown error'}`);
                // Still a success in terms of sending to GPU, but local tracking failed.
                return { success: true, message: `Inference accepted by GPU (Job ID: ${inferenceResult.jobId}), but failed to track job locally. UUID: ${jobUuid}`, uuid: jobUuid };
            }
        } else if (inferenceResult.success) { // Success but no jobId (should be handled by sendInferenceRequestToCloudGpu logic)
            logger.warn(`${serviceLocation}: Inference request reported success for project ${projectId} but no definite Job ID was returned from GPU. Local UUID: ${jobUuid}`);
            // Decide how to handle this - maybe still create a local job with PENDING status
            return { success: true, message: `Inference request sent for project ${projectId}, but no Job ID was clearly identified from GPU. UUID: ${jobUuid}`, uuid: jobUuid };
        } else {
            logger.error(`${serviceLocation}: Failed to send inference request for project ${projectId}: ${inferenceResult.error}`);
            return { success: false, message: `Failed to start inference: ${inferenceResult.error}` };
        }

    } catch (error: any) {
        logger.error(`${serviceLocation}: Critical error starting inference for project ${projectId}:`, error);
        return { success: false, message: `Error starting inference: ${error.message}` };
    }
};