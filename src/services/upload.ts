// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import fs from "fs";
import crypto from "crypto";
import { createFile } from "./database"; // Handles database insert for file metadata
import { Express } from "express";

/**
 * Processes uploaded files by generating hashes and saving metadata.
 * 
 * @param files - Array of uploaded files from Multer.
 * @param createdBy - ID of the user or guest who uploaded the files.
 * @returns An object indicating success or failure, with details of each uploaded file.
 */
export const processUpload = async (
  files: Express.Multer.File[],
  createdBy: string
) => {
  const uploadedFilesDetails = [];

  for (const file of files) {
    const localPath = file.path;

    try {
      // Read the file from disk
      const fileBuffer = fs.readFileSync(localPath);

      // Generate a SHA-256 hash for integrity tracking
      const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      const { originalname, mimetype, size } = file;

      // Save file metadata to the database
      const result = await createFile(
        originalname,  // Original filename
        localPath,     // Server-side file path
        mimetype,      // File MIME type
        fileHash,      // Content hash
        size,          // File size in bytes
        createdBy,     // User or guest ID
        undefined      // Optional description (not used here)
      );

      // Handle potential DB error
      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Push file details to the response array
      uploadedFilesDetails.push({
        originalName: originalname,
        storedAs: file.filename,
        size: file.size,
        path: localPath
      });

    } catch (error) {
      // Catch any processing errors and return failure immediately
      return { success: false, error };
    }
  }

  // Final response with success and all uploaded file info
  return { success: true, uploadedFiles: uploadedFilesDetails };
};
