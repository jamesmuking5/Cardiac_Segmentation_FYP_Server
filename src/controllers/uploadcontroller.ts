// File: src/controllers/uploadcontroller.ts
// Description: Controller to handle file upload requests and process them using the upload service.

import { Request, Response } from "express";
import { processUpload } from "../services/upload";

export const handleUpload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const userId = req.body.userId;

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "No files uploaded." });
  }

  if (!userId) {
    return res.status(400).json({ message: "Missing userId." });
  }

  const result = await processUpload(files, userId);

  if (!result.success) {
    return res.status(500).json({ message: "Upload failed.", error: result.error });
  }

  return res.status(200).json({
    message: "Projects uploaded successfully.",
    uploadedProjects: result.uploadedProjects,
  });
};
