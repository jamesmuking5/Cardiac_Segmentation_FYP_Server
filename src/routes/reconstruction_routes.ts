import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startReconstruction } from "../services/reconstruction";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import {
    jobModel,
    JobStatus,
    readProjectReconstruction,
    projectReconstructionModel,
    readProject,
    IProjectDocument
} from "../services/database";
import { isAuth, isAuthAndNotGuest } from "../services/passportjs";
import { extractS3KeyFromUrl } from "../services/s3_handler";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import LogError from "../utils/error_logger";

const router = Router();
const serviceLocation = "ReconstructionRoutes";

/**
 * Start 4D cardiac reconstruction job
 * Follows the same pattern as segmentation routes - delegates to service layer
 * 
 * @route POST /reconstruction/start-4d/:projectId
 * @access Private (authenticated users only)
 */
router.post("/start-reconstruction/:projectId",
    isAuth,
    isAuthAndNotGuest,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId } = req.params;
        const { reconstructionName, reconstructionDescription, parameters, ed_frame } = req.body;
        
        logger.info(`${serviceLocation}: Received start 4D reconstruction request for project ${projectId} with ed_frame ${ed_frame} by user ${req.user?.username} with id ${req.user?._id}`);
        
        try {
            const result = await startReconstruction(projectId, req.user, reconstructionName, reconstructionDescription, parameters, ed_frame);
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid });
            } else {
                res.status(500).json({ message: result.message });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting 4D reconstruction");
            if (!res.headersSent) {
                res.status(500).json({ message: "An unexpected error occurred while starting 4D reconstruction." });
            }
        }
    });

/**
 * Get reconstruction results for a project
 * Follows the exact pattern of /segmentation/segmentation-results/:projectId
 * 
 * @route GET /reconstruction/reconstruction-results/:projectId
 * @access Private (authenticated users only)
 */
router.get("/reconstruction-results/:projectId", isAuth, async (req: Request, res: Response) => {
    const { projectId } = req.params;

    if (!projectId) {
        logger.warn(`${serviceLocation}: Project ID is required to fetch reconstruction results.`);
        return res.status(400).json({ message: "Project ID is required." });
    }
    logger.info(`${serviceLocation}: Received request to fetch reconstruction results for project ID: ${projectId}`);
    try {
        const result = await readProjectReconstruction(projectId);
        if (!result.success) {
            if (result.message?.includes("does not exist")) {
                logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching reconstruction results.`);
                return res.status(404).json({ success: false, message: result.message });
            }
            logger.error(`${serviceLocation}: Error reading reconstruction results for project ${projectId}: ${result.message}`);
            return res.status(500).json({ success: false, message: result.message || "Error reading reconstruction results." });
        }
        if (!result.projectreconstructions || result.projectreconstructions.length === 0) {
            logger.info(`${serviceLocation}: No reconstruction results found for project ID ${projectId}.`);
            return res.status(200).json({
                message: "No reconstruction results found for this project.",
                success: false,
                reconstructions: []
            });
        }

        // Generate presigned URLs for each reconstruction's mesh.tar file
        const reconstructionsWithUrls = await Promise.all(
            result.projectreconstructions.map(async (recon) => {
                let downloadUrl = null;
                
                // Generate presigned URL if mesh file exists
                if (recon.reconstructedMesh?.path) {
                    try {
                        const s3Key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
                        if (s3Key) {
                            const awsBucketName = process.env.AWS_BUCKET_NAME;
                            if (awsBucketName) {
                                downloadUrl = await generatePresignedGetUrl(
                                    awsBucketName, 
                                    s3Key, 
                                    3600 // 1 hour expiry
                                );
                            }
                        }
                    } catch (urlError) {
                        logger.warn(`${serviceLocation}: Failed to generate presigned URL for reconstruction ${recon._id}: ${(urlError as Error).message}`);
                    }
                }

                return {
                    reconstructionId: recon._id,
                    name: recon.name,
                    description: recon.description,
                    isSaved: recon.isSaved,
                    isAIGenerated: recon.isAIGenerated,
                    meshFormat: recon.meshFormat,
                    meshFileSize: recon.reconstructedMesh?.filesize,
                    downloadUrl, // Presigned URL for download
                    metadata: {
                        edFrameIndex: recon.ed_frame,
                        reconstructionTime: recon.reconstructedMesh?.reconstructionTime,
                        numIterations: recon.reconstructedMesh?.numIterations,
                        resolution: recon.reconstructedMesh?.resolution,
                        filename: recon.reconstructedMesh?.filename,
                        filesize: recon.filesize,
                        filehash: recon.filehash
                    },
                    createdAt: recon.createdAt,
                    updatedAt: recon.updatedAt,
                };
            })
        );

        logger.info(`${serviceLocation}: Successfully fetched ${result.projectreconstructions.length} reconstruction(s) for project ID ${projectId}.`);
        return res.status(200).json({ success: true, reconstructions: reconstructionsWithUrls });
    } catch (error) {
        LogError(error as Error, serviceLocation, `Unexpected error fetching reconstruction results for project ${projectId}`);
        return res.status(500).json({ message: "An unexpected error occurred while fetching reconstruction results." });
    }
});

/**
 * Check all reconstruction jobs for current user
 * Matches segmentation pattern: /segmentation/user-check-jobs
 * 
 * @route GET /reconstruction/user-check-jobs
 * @access Private (authenticated users only)
 */
router.get("/user-check-jobs", isAuth, async (req: Request, res: Response) => {
    const userId = req.user?._id;
    logger.info(`${serviceLocation}: Fetching all reconstruction jobs for user ${req.user?.username}`);
    
    try {
        const jobs = await jobModel.find({ userid: userId }).sort({ createdAt: -1 }).limit(20);
        const pendingJobs = await jobModel.find({ status: JobStatus.PENDING }).sort({ createdAt: 1 });
        const activeJobCount = await jobModel.countDocuments({
            userid: userId,
            status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] }
        });
        
        return res.status(200).json({
            success: true,
            activeJobCount,
            totalJobs: jobs.length,
            jobs: jobs.map((job: any) => {
                let queuePosition = null;
                if (job.status === JobStatus.PENDING) {
                    queuePosition = pendingJobs.findIndex(j => j.uuid === job.uuid) + 1;
                }
                return {
                    jobId: job.uuid,
                    projectId: job.projectid,
                    status: job.status,
                    name: job.segmentationName,
                    description: job.segmentationDescription,
                    queuePosition: queuePosition
                };
            })
        });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error fetching reconstruction jobs for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching reconstruction jobs"
        });
    }
});

/**
 * Batch endpoint for checking reconstruction status of multiple projects
 * Matches segmentation pattern: /segmentation/batch-segmentation-status
 * 
 * @route POST /reconstruction/batch-reconstruction-status
 * @access Private (authenticated users only)
 */
router.post("/batch-reconstruction-status", isAuth, async (req: Request, res: Response) => {
    const { projectIds } = req.body;
    const userId = req.user?._id;

    logger.info(`${serviceLocation}: Batch reconstruction status check for ${projectIds?.length || 0} projects by user ${req.user?.username}`);

    if (!userId) {
        logger.warn(`${serviceLocation}: User ID not found in request.`);
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
        logger.warn(`${serviceLocation}: Invalid or empty projectIds array in batch reconstruction status request.`);
        return res.status(400).json({
            success: false,
            message: "projectIds array is required and must not be empty."
        });
    }

    // Limit batch size to prevent abuse
    if (projectIds.length > 50) {
        logger.warn(`${serviceLocation}: Batch size too large: ${projectIds.length} projects requested.`);
        return res.status(400).json({
            success: false,
            message: "Batch size limited to 50 projects per request."
        });
    }

    try {
        // 1. Verify user owns all requested projects
        const userProjectsResult = await readProject(undefined, userId.toString());
        if (!userProjectsResult.success || !userProjectsResult.projects) {
            logger.error(`${serviceLocation}: Failed to fetch user projects for batch status check.`);
            return res.status(500).json({
                success: false,
                message: "Failed to verify project ownership."
            });
        }

        const userProjectIds = userProjectsResult.projects.map((p: IProjectDocument) => (p._id as string).toString());
        const unauthorizedProjects = projectIds.filter((id: string) => !userProjectIds.includes(id));

        if (unauthorizedProjects.length > 0) {
            logger.warn(`${serviceLocation}: User ${userId} attempted to check reconstruction status for unauthorized projects: ${unauthorizedProjects.join(', ')}`);
            return res.status(403).json({
                success: false,
                message: "Access denied to some requested projects."
            });
        }

        // 2. Batch query reconstruction results using MongoDB aggregation
        const reconstructionResults = await projectReconstructionModel.aggregate([
            {
                $match: {
                    projectid: { $in: projectIds }
                }
            },
            {
                $group: {
                    _id: "$projectid",
                    reconstructionCount: { $sum: 1 },
                    hasReconstructions: { $sum: { $cond: [{ $ne: ["$reconstructedMesh", null] }, 1, 0] } }
                }
            }
        ]);

        // 3. Build response object with status for each project
        const statusMap: Record<string, { hasReconstructions: boolean; reconstructionCount: number }> = {};

        // Initialize all projects as having no reconstructions
        projectIds.forEach((projectId: string) => {
            statusMap[projectId] = { hasReconstructions: false, reconstructionCount: 0 };
        });

        // Update with actual results
        reconstructionResults.forEach((result: { _id: string; reconstructionCount: number; hasReconstructions: number }) => {
            statusMap[result._id] = {
                hasReconstructions: result.hasReconstructions > 0,
                reconstructionCount: result.reconstructionCount
            };
        });

        logger.info(`${serviceLocation}: Successfully processed batch reconstruction status for ${projectIds.length} projects. Found reconstructions for ${reconstructionResults.length} projects.`);

        return res.status(200).json({
            success: true,
            statuses: statusMap
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error in batch reconstruction status check for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while checking reconstruction status."
        });
    }
});

export default router;