import { projectModel, projectSegmentationMaskModel, deleteProject } from "../services/database";
import { cleanupUserS3Storage, deleteFromS3, extractS3KeyFromUrl } from "../services/s3_handler";
import logger from "../services/logger";

/**
 * Handles the save/unsave logic for user projects and segmentation masks.
 * - Updates `isSaved` for projects and segmentation masks.
 * - Deletes unsaved projects and segmentation masks (and their associated S3 files).
 *
 * @async
 * @function handleUserSaveUnsave
 * @param {string} userId - The ID of the user whose projects and masks are being processed.
 * @param {boolean} isSaved - The `isSaved` status to apply. If `false`, unsaved data will be deleted.
 * @returns {Promise<void>}
 */
export const handleUserSaveUnsave = async (userId: string, isSaved: boolean): Promise<void> => {
  const serviceLocation = "Projectcleanupjob";
  try {
    logger.info(`${serviceLocation}: Starting save/unsave process for user ${userId} with isSaved=${isSaved}.`);

    // Step 1: Find all projects for the user
    const userProjects = await projectModel.find({ userid: userId }).lean();
    if (!userProjects || userProjects.length === 0) {
      logger.info(`${serviceLocation}: No projects found for user ${userId}.`);
      return;
    }

    // Step 2: Process each project
    for (const project of userProjects) {
      if (isSaved) {
        // Update `isSaved` to true for the project and its segmentation masks
        project.isSaved = true;
        await projectModel.updateOne({ _id: project._id }, { $set: { isSaved: true } });
        // Also update all associated segmentation masks to isSaved = true (which has no effect currently in the new frontend)
        await projectSegmentationMaskModel.updateMany({ projectid: project._id }, { $set: { isSaved: true } });
        logger.info(`${serviceLocation}: Marked project ${project._id} and its segmentation masks as saved.`);
      } else if (!project.isSaved) {
        // If `isSaved = false`, delete the project and its associated data
        logger.info(`${serviceLocation}: Deleting unsaved project ${project._id} and its associated data.`);

        // Step 2.1: Delete the S3 files for this specific project
        if (project.originalfilepath) {
          const originalKey = extractS3KeyFromUrl(project.originalfilepath);
          if (originalKey) {
            const success = await deleteFromS3(originalKey);
            if (!success) {
              logger.warn(`${serviceLocation}: Failed to delete original S3 file for project ${project._id}: ${originalKey}`);
            }
          }
        }
        
        if (project.extractedfolderpath) {
          const extractedKey = extractS3KeyFromUrl(project.extractedfolderpath);
          if (extractedKey) {
            const success = await deleteFromS3(extractedKey);
            if (!success) {
              logger.warn(`${serviceLocation}: Failed to delete extracted S3 file for project ${project._id}: ${extractedKey}`);
            }
          }
        }

        // Step 2.2: Delete the project (cascade deletes segmentation masks)
        const deleteResult = await deleteProject(project._id.toString());
        if (deleteResult.success) {
          logger.info(`${serviceLocation}: Successfully deleted project ${project._id}.`);
        } else {
          logger.warn(`${serviceLocation}: Failed to delete project ${project._id}: ${deleteResult.message}`);
        }
      }
    }

    logger.info(`${serviceLocation}: Save/unsave process completed for user ${userId}.`);
  } catch (error) {
    logger.error(`${serviceLocation}: Error during save/unsave process for user ${userId}:`, error);
  }
};