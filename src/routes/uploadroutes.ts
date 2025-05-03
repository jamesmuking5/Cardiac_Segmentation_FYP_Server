// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response, NextFunction } from "express";
import { upload } from "../middleware/uploadmiddleware";
import { handleUpload } from "../services/upload";
import { isAuth } from "../services/passportjs";
import logger from "../services/logger"; // Import Winston Logger


const serviceLocation = "API(Upload)";
const router = express.Router();

// Upload route with PUT method
router.put("/upload", isAuth, upload.any(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info(`${serviceLocation}: Received file upload request from user ${req.user?.username} with id ${req.user?._id}`);
    await handleUpload(req, res);
  } catch (error) {
    next(error);
  }
});

// Informative GET route
router.get("/upload", (req: Request, res: Response) => {
  res.send("Use PUT method to upload files.");
});


// Get project routes?
// Get project information routes?
// Get mask routes?

export default router;