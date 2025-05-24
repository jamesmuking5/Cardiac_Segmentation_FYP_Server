// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response } from "express";
import { projectUploadFilter } from "../middleware/uploadmiddleware";
import { saveFileAndPushToS3 } from "../services/project_handler";
import { isAuth, isAuthAndNotGuest, isAuthAndAdmin } from "../services/passportjs";
import { readProject, updateProject, readUser } from "../services/database";
import { FileType } from "../types/database_types"; // Import FileType enum
import { extractS3KeyFromUrl } from "../services/s3_handler"; // Import S3 URL utility
import { generatePresignedGetUrl } from "../utils/s3_presigned_url"; // Import S3 presigned URL utility
import { userModel } from "../services/database"; // Import UserModel

import logger from "../services/logger"; // Import Winston Logger
import LogError from "../utils/error_logger"; // Import error logging utility

const serviceLocation = "API(Upload)";
const router = express.Router();

// Upload route with PUT method
router.put("/upload-new-project",
  isAuth,
  projectUploadFilter,
  async (req: Request, res: Response) => {
    try {
      // Check for empty files array (might slip through middleware)
      if (!req.files || Array.isArray(req.files) && req.files.length === 0) {
        return res.status(400).json({ success: false, message: "No files were uploaded" });
      }
      
      logger.info(`${serviceLocation}: Received file upload request from user ${req.user?.username}`);
      await saveFileAndPushToS3(req, res);
      
      // If reached here but no response was sent, handle it gracefully (should not)
      if (!res.headersSent) {
        logger.warn(`${serviceLocation}: No response sent after saveFileAndPushToS3`);
        return res.status(500).json({ success: false, message: "Upload processed but no response generated" });
      }
    } catch (error) {
      // More specific error handling based on error type
      if (error instanceof TypeError || error instanceof ReferenceError) {
        logger.error(`${serviceLocation}: Programming error in upload handler: ${error.message}`);
        return res.status(500).json({ success: false, message: "Server configuration error" });
      }
      
      LogError(error as Error, serviceLocation, "Error handling file upload");
      return res.status(500).json({ success: false, message: "An error occurred while processing the upload." });
    }
  });

// Route to read/search projects (limited to id, name, filetype, daterange)
router.get("/get-allusers-with-projects", isAuthAndAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await readUser({}); 

    if (!result.success || !result.users) {
      res.status(404).json({ fetch: false, message: "No users found or error fetching users." });
      return;
    }

    // Fetch projects for each user
    const usersWithProjects = await Promise.all(result.users.map(async (user) => {
      const projectResult = await readProject(undefined, user._id);
      
      return {
        userId: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        projectCount: projectResult.success && projectResult.projects ? projectResult.projects.length : 0,
        projects: projectResult.success && projectResult.projects ? projectResult.projects.map(project => ({
          projectId: project._id,
          name: project.name,
          description: project.description,
          isSaved: project.isSaved,
          filesize: project.filesize,
          filetype: project.filetype,
          dimensions: project.dimensions,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        })) : []
      };
    }));

    // Filter out users with no projects
    const usersWithProjectsOnly = usersWithProjects.filter(user => user.projectCount > 0);

    logger.info(`${serviceLocation}: Fetched ${usersWithProjectsOnly.length} users with projects.`);
    res.status(200).json({
      fetch: true,
      totalUsers: usersWithProjectsOnly.length,
      data: usersWithProjectsOnly
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error fetching users with projects: ${error}`);
    res.status(500).json({ fetch: false, message: "Internal error during fetch." });
  }
});

router.get("/get-allusers-with-projects", isAuthAndAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await readUser({}); 

    if (!result.success || !result.users) {
      res.status(404).json({ fetch: false, message: "No users found or error fetching users." });
      return;
    }

    // Fetch projects for each user
    const usersWithProjects = await Promise.all(result.users.map(async (user) => {
      const projectResult = await readProject(undefined, user._id);
      
      return {
        userId: user._id,
        username: user.username, // Include username as you mentioned
        projectCount: projectResult.success && projectResult.projects ? projectResult.projects.length : 0,
        projects: projectResult.success && projectResult.projects ? projectResult.projects.map(project => ({
          projectId: project._id,
          name: project.name,
          description: project.description,
          isSaved: project.isSaved,
          filesize: project.filesize,
          filetype: project.filetype,
          dimensions: project.dimensions,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        })) : []
      };
    }));

    logger.info(`${serviceLocation}: Fetched all users with their projects.`);
    res.status(200).json({
      fetch: true,
      totalUsers: usersWithProjects.length,
      data: usersWithProjects
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error fetching users with projects: ${error}`);
    res.status(500).json({ fetch: false, message: "Internal error during fetch." });
  }
});

// Route to update project name and/or description
router.patch("/update-project", isAuth, async (req: Request, res: Response) => {
    const { projectId, name, description } = req.body;
    const userId = (req.user as any)?._id;
  
    if (!projectId) {
      return res.status(400).json({ message: "Missing projectId." });
    }
    if (!name && !description) {
      return res.status(400).json({ message: "Please provide a name or description to update." });
    }
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized." });
    }
  
    try {
      const updateFields: { name?: string; description?: string } = {};
      if (name !== undefined) {
        updateFields.name = name;
      }
      if (description !== undefined) {
        updateFields.description = description;
      }
  
      const result = await updateProject(projectId, updateFields);
      if (result.success) {
        return res.status(200).json({ message: "Project details updated successfully." });
      } else {
        return res.status(404).json({ message: result.message });
      }
    } catch (error: any) {
      logger.error(`${serviceLocation}: Error updating project ${projectId} - ${error.message}`);
      return res.status(500).json({ message: "Failed to update project details." });
    }
});

// Route to save project (isSaved = true)
// This route is for updating project status to save, so that cron job would not delete
router.patch("/save-project", isAuthAndNotGuest, async (req: Request, res: Response) => {
  try {
    const { projectId, isSaved } = req.body;
    const userId = (req.user)?._id;
    
    // Check for user authentication
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized. User ID not found." 
      });
    }
    
    // If projectId and isSaved are not provided, return error
    if (!projectId) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing projectId." 
      });
    }
    
    if (isSaved === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing isSaved value." 
      });
    }

    // Check if isSaved is a valid boolean
    if (typeof isSaved !== "boolean") {
      return res.status(400).json({ 
        success: false, 
        message: "isSaved must be a boolean." 
      });
    }

    // Check if projectId is valid and belongs to the user
    const projectExist = await readProject(projectId, userId);
    
    // Handle case where project doesn't exist or doesn't belong to user
    if (!projectExist.success) {
      return res.status(404).json({ 
        success: false, 
        message: projectExist.message || `Error looking up project ${projectId}.` 
      });
    }
    
    if (!projectExist.projects || projectExist.projects.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: `Project ${projectId} not found or you don't have access to it.` 
      });
    }

    // Update the project status - pass both projectId and userId for security
    const updateProjectToSaved = await updateProject(
      projectId,
      { isSaved: isSaved } // Update only the isSaved field
    );

    // Handle update result with proper error handling
    if (updateProjectToSaved.success) {
      logger.info(`${serviceLocation}: User ${userId} updated project ${projectId} saved status to ${isSaved}`);
      return res.status(200).json({ 
        success: true,
        message: `Project ${projectId} saved status updated to ${isSaved}.` 
      });
    } else {
      // Handle failed update
      return res.status(400).json({ 
        success: false, 
        message: updateProjectToSaved.message || `Failed to update saved status for project ${projectId}.` 
      });
    }
  } catch (error) {
    // Catch and log any unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    LogError(
      error instanceof Error ? error : new Error(errorMessage),
      serviceLocation,
      `Error updating project saved status for project ID: ${req.body?.projectId}`
    );
    
    return res.status(500).json({ 
      success: false,
      message: "An unexpected error occurred while updating the project status." 
    });
  }
});

// Add this endpoint to get presigned URLs for project files
router.get("/get-project-presigned-url", isAuth, async (req: Request, res: Response) => {
    try {
        const projectId = req.query.projectId as string;
        const userId = (req.user as any)?._id;
        const projectResult = await readProject(projectId, userId);
        
        if (!projectResult.success || !projectResult.project) {
            return res.status(404).json({ success: false, message: "Project not found" });
        }
        
        // Extract the S3 key from the URL
        const s3HttpsUrlForTar = projectResult.project.extractedfolderpath;
        if (!s3HttpsUrlForTar) {
            return res.status(404).json({ success: false, message: "Project has no associated file" });
        }
        
        // Use the existing function to extract the key
        const objectKey = extractS3KeyFromUrl(s3HttpsUrlForTar);
        if (!objectKey) {
            return res.status(400).json({ success: false, message: "Invalid S3 URL format" });
        }
        
        // Generate presigned URL with existing function
        const presignedUrl = await generatePresignedGetUrl(
            process.env.AWS_BUCKET_NAME!,
            objectKey,
            1800 // 30 minutes for frontend use
        );
        
        if (!presignedUrl) {
            return res.status(500).json({ success: false, message: "Failed to generate presigned URL" });
        }
        
        return res.json({ 
            success: true, 
            presignedUrl,
            expiresAt: Date.now() + (1800 * 1000)
        });
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error generating presigned URL: ${error.message}`, error);
        return res.status(500).json({ success: false, message: "Server error generating presigned URL" });
    }
});

export default router;