// File: src/controllers/uploadcontroller.ts
// Description: Controller to handle file upload requests and process them using the upload service.

import { Request, Response } from "express";
import { processUpload } from "../services/upload";

//Controller to handle file upload requests.
export const handleUpload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "No files uploaded." });
  }

  const userId = req.body.userId;
  const guestId = req.body.guestId;
  const createdBy = userId || guestId;

  if (!createdBy) {
    return res.status(400).json({ message: "Missing userId or guestId." });
  }

  const result = await processUpload(files, createdBy);

  if (!result.success) {
    return res.status(500).json({ message: "Error uploading files", error: result.error });
  }

  return res.status(200).json({
    message: "Files uploaded and processed successfully.",
    uploadedBy: userId ? `userId: ${userId}` : `guestId: ${guestId}`,
    uploadedFiles: result.uploadedFiles
  });
};
