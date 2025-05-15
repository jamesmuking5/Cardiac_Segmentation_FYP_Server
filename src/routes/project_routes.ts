// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response } from "express";
import { projectUploadFilter } from "../middleware/uploadmiddleware";
import { saveFileAndPushToS3 } from "../services/project_handler";
import { isAuth } from "../services/passportjs";
import logger from "../services/logger"; // Import Winston Logger
import LogError from "../utils/error_logger"; // Import error logging utility

const serviceLocation = "API(Upload)";
const router = express.Router();

// Upload route with PUT method
router.put("/upload-new-project",
  isAuth, // Middleware to check if the user is authenticated
  projectUploadFilter, // Checks if the uploaded file in req.file and fields in req.body are valid
  async (req: Request, res: Response) => {
    try {
      logger.info(`${serviceLocation}: Received file upload request from user ${req.user?.username} with id ${req.user?._id}`);
      await saveFileAndPushToS3(req, res);
    } catch (error) {
      LogError(error as Error, serviceLocation, "Error handling file upload");
      res.status(500).json({ success: false, message: "An error occurred while processing the upload." });
    }
  });

// Get project routes?
// Get project information routes?
// Get mask routes?

export default router;