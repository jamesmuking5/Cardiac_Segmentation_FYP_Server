// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response } from "express";
import { projectUploadFilter } from "../middleware/uploadmiddleware";
import { saveFileAndPushToS3 } from "../services/project_handler";
import { isAuth } from "../services/passportjs";
import { readProject, updateProject } from "../services/database";
import { FileType } from "../types/database_types"; // Import FileType enum

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
router.get("/get-projects-list", isAuth, async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;

  const { projectid, name, filetype: filetypeParam, daterange: daterangeParam } = req.query;

  // Helper function to safely parse JSON query parameters
  const tryParseJSON = (value: any) => {
    try {
      return JSON.parse(value as string);
    } catch (error) {
      return undefined;
    }
  };

  try {
    const filetype: FileType[] | undefined = Array.isArray(filetypeParam)
      ? filetypeParam.filter((type): type is FileType => Object.values(FileType).includes(type as FileType))
      : filetypeParam && Object.values(FileType).includes(filetypeParam as FileType)
      ? [filetypeParam as FileType]
      : undefined;

    const daterange: { start?: Date; end?: Date } | undefined = tryParseJSON(daterangeParam);

    const result = await readProject(
      projectid as string | undefined,
      userId,
      name as string | undefined,
      undefined, // description - not a filter
      undefined, // isSaved - not a filter
      undefined, // filename - not a filter
      filetype,
      undefined, // filesize - not a filter
      undefined, // filehash - not a filter
      undefined, // datatype - not a filter
      undefined, // dimensions - not a filter
      undefined, // voxelsize - not a filter
      daterange
    );

    if (result.success && result.projects) {
      // Sanitize the projects
      const sanitized_results = result.projects.map((project) => {
        return {
          projectId: project._id,
          name: project.name,
          description: project.description,
          isSaved: project.isSaved,
          filesize: project.filesize,
          filetype: project.filetype,
          dimensions: project.dimensions,
          voxelsize: project.voxelsize,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      });

      return res.status(200).json({ projects: sanitized_results }); // Return the projects
    } else {
      return res.status(404).json({ message: result.message });
    }
  } catch (error: any) {
    logger.error(`${serviceLocation}: Error reading projects - ${error.message}`);
    return res.status(500).json({ message: "Failed to retrieve projects." });
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

export default router;