import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startReconstruction } from "../services/reconstruction";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import {
    jobModel,
    JobStatus
} from "../services/database";
import { isAuth, isAuthAndNotGuest } from "../services/passportjs";
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
        const { reconstructionName, reconstructionDescription, parameters } = req.body;
        
        logger.info(`${serviceLocation}: Received start 4D reconstruction request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
        
        try {
            const result = await startReconstruction(projectId, req.user, reconstructionName, reconstructionDescription, parameters);
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

export default router;