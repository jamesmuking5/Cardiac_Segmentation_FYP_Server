import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startInference } from "../services/inference"; // Import startInference function
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware"; // Import GPU auth middleware
// import { readProjectSegmentationMask } from "../services/database";
import { isAuth } from "../services/passportjs"; 
import LogError from "../utils/error_logger";

const router = Router();
const serviceLocation = "SegmentationRoutes";

// Route to start inference for a specific project
router.post("/start-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const { projectId } = req.params;
        logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
        try {
            logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}`);
            const result = await startInference(projectId, req.user, res.locals.gpuAuthToken); // Pass the token here
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid }); // Return the UUID to the client
            } else {
                res.status(500).json({ message: result.message });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting inference");
        }
    });

    
// router.get("/results/project/:projectId", isAuth, async (req: Request, res: Response) => {
//     const { projectId } = req.params;

//     if (!projectId) {
//         logger.warn(`${serviceLocation}: Project ID is required to fetch segmentation masks.`);
//         return res.status(400).json({ message: "Project ID is required." });
//     }

//     logger.info(`${serviceLocation}: Received request to fetch segmentation masks for project ID: ${projectId}`);

//     try {
//         const result = await readProjectSegmentationMask(projectId);

//         if (!result.success) {
//             // Differentiate between "project not found" and other errors
//             if (result.message?.includes("does not exist")) {
//                 logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching segmentation masks.`);
//                 return res.status(404).json({ message: result.message });
//             }
//             logger.error(`${serviceLocation}: Error reading segmentation masks for project ${projectId}: ${result.message}`);
//             return res.status(500).json({ message: result.message || "Error reading segmentation masks." });
//         }

//         // Handle case where project exists but has no segmentation masks
//         if (!result.projectsegmentationmasks || result.projectsegmentationmasks.length === 0) {
//             logger.info(`${serviceLocation}: No segmentation masks found for project ID ${projectId}.`);
//             return res.status(200).json({ 
//                 message: "No segmentation masks found for this project.", 
//                 segmentations: [] 
//             });
//         }

//         logger.info(`${serviceLocation}: Successfully fetched ${result.projectsegmentationmasks.length} segmentation mask(s) for project ID ${projectId}.`);
//         // The frontend will receive an array of IProjectSegmentationMaskDocument objects
//         return res.status(200).json({ segmentations: result.projectsegmentationmasks });

//     } catch (error) {
//         LogError(error as Error, serviceLocation, `Unexpected error fetching segmentation masks for project ${projectId}`);
//         return res.status(500).json({ message: "An unexpected error occurred while fetching segmentation masks." });
//     }
// });

export default router;