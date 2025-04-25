// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import fs from "fs";
import mongoose from "mongoose";
import { Express } from "express";
import { uploadToS3 } from "../middleware/uploadmiddleware";
import { createProject } from "./database";
import { IProject } from "../types/database_types";
import { extractNiftiMetadata } from "../utils/nifti_parser";
import {
  isValidFileFormat,
  computeFileHash,
  isS3Storage,
  isLocalStorage,
  mapToFileDataType
} from "../utils/upload_helper";

export const processUpload = async (
  files: Express.Multer.File[],
  userId: string
) => {
  const uploadedProjects: IProject[] = [];
  const storageMode = process.env.STORAGE_MODE || "local";

  for (const file of files) {
    const { originalname, mimetype, size, path: filePath } = file;

    try {
      // Validate file format
      if (!isValidFileFormat(originalname)) {
        return {
          success: false,
          error: "Invalid file format. Only .nii or .nii.gz allowed.",
        };
      }

      // Read file and compute SHA-256 hash
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = computeFileHash(fileBuffer);

      // Handle file storage (local or S3)
      const storedPath = isS3Storage(storageMode)
        ? await uploadToS3(file)
        : filePath;

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}.nii`;

      // Extract NIfTI metadata using the Python integration
      const niftiMetadata = await extractNiftiMetadata(filePath);

      // Construct project metadata object
      const project: IProject = {
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
          extract: true,
        },
        datatype: mapToFileDataType(niftiMetadata.datatype),
        dimensions: {
          width: niftiMetadata.dimensions.width ?? 0,
          height: niftiMetadata.dimensions.height ?? 0,
          slices: niftiMetadata.dimensions.slices ?? 0,
        },
        voxelsize: {
          x: niftiMetadata.voxelsize.x ?? 0,
          y: niftiMetadata.voxelsize.y ?? 0,
          z: niftiMetadata.voxelsize.z ?? 0,
          t: niftiMetadata.voxelsize.t ?? 0,
        },
      };

      // Insert metadata into the database
      const result = await createProject(
        project.userid,
        project.name,
        project.originalfilename,
        project.isSaved,
        project.filename,
        project.filetype,
        project.filesize,
        project.filehash,
        project.basepath,
        project.originalfilepath,
        project.extractedfolderpath,
        project.status,
        project.datatype,
        project.dimensions,
        project.voxelsize,
      );

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
