// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import fs from "fs";
import crypto from "crypto";
import { createFile } from "./database"; // Handles database insert for file metadata
import { Express } from "express";
import { uploadToS3 } from "../middleware/uploadmiddleware"; // For S3 uploads

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

  // Check if the environment is set to use local or S3 storage
  const storageMode = process.env.STORAGE_MODE;

  for (const file of files) {
    const { originalname, mimetype, size } = file;
    let storedPath = "";
    
    try {
      // Read the file from disk (if necessary)
      const fileBuffer = fs.readFileSync(file.path);

      // Generate a SHA-256 hash for integrity tracking
      const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      // Depending on the storage mode, either save locally or upload to S3
      if (storageMode === "s3") {
        // If using S3, upload to the bucket and get the URL
        storedPath = await uploadToS3(file);  // Assuming this function uploads the file and returns the S3 URL
      } else {
        // Save locally (static storage)
        storedPath = file.path;  // This assumes you already configured disk storage
      }

      // Save file metadata to the database
      const result = await createFile(
        originalname,  // Original filename
        storedPath,    // File storage path (either local path or S3 URL)
        mimetype,      // MIME type
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
        storedAs: storedPath, // Local path or S3 URL
        size: file.size,
        path: storedPath
      });

    } catch (error) {
      // Catch any processing errors and return failure immediately
      return { success: false, error };
    }
  }

  // Final response with success and all uploaded file info
  return { success: true, uploadedFiles: uploadedFilesDetails };
};
