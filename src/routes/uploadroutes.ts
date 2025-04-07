// File: src/routes/uploadRoutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response, NextFunction } from "express";
import { upload } from "../middleware/uploadmiddleware"; // Importing the multer middleware
import { handleUpload } from "../controllers/uploadcontroller"; // Importing the controller

const router = express.Router();

/**
 * RESTful API route to handle file uploads.
 * This route accepts multiple files and handles them using multer's `upload.any()`.
 */
router.post("/upload", upload.any(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        await handleUpload(req, res);  // Calling the controller method to handle file upload logic
    } catch (error) {
        next(error); // Passing errors to the global error handler
    }
});

/**
 * GET route to inform about the expected HTTP method for file uploads.
 * This route only supports POST requests for file uploads.
 */
router.get("/upload", (req: Request, res: Response) => {
    res.send("This route only supports POST for file uploads.");
});

export default router;
