// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import fs from "fs";
import crypto from "crypto";
import mongoose from "mongoose";
import { Express } from "express";
import { uploadToS3 } from "../middleware/uploadmiddleware";
import { createProject } from "./database";
import { IProject } from "../types/database_types";

export const processUpload = async (
  files: Express.Multer.File[],
  userId: string
) => {
  const uploadedProjects: IProject[] = [];
  const storageMode = process.env.STORAGE_MODE;

  for (const file of files) {
    const { originalname, mimetype, size, path: filePath } = file;

    try {
      // Only allow .nii and .nii.gz
      if (!originalname.endsWith(".nii") && !originalname.endsWith(".nii.gz")) {
        return {
          success: false,
          error: "Invalid file format. Only .nii or .nii.gz allowed.",
        };
      }

      // Read the file and compute SHA-256 hash
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      // Handle storage path (local or S3)
      const storedPath = storageMode === "s3"
        ? await uploadToS3(file)
        : filePath;

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}.nii`;

      // Construct project metadata (stub for now, real metadata extraction can follow)
      const project: IProject = {
        _id: projectId, // Explicitly set ID if required by schema
        userid: userId,
        name: originalname,
        originalfilename: originalname,
        description: "",
        isSaved: true,
        filename: generatedFilename,
        filetype: mimetype as any,
        filesize: size,
        filehash: fileHash,
        basepath: storedPath,
        originalfilepath: storedPath,
        extractedfolderpath: "",
        status: {
          upload: true,
          extract: false,
        },
        datatype: "float32", // Placeholder - can parse file data to extract the real datatype ltr using nifti-reader-js
        dimensions: {
          width: 0,
          height: 0,
          slices: 0,
        },
        voxelsize: {
          x: 0,
          y: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Insert into DB
      const result = await createProject(project);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      uploadedProjects.push(project);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  return { success: true, uploadedProjects };
};