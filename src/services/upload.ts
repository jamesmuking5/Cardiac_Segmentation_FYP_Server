// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import { Request, Response } from "express";
import fs from "fs";
import mongoose from "mongoose";
import { uploadToS3 } from "../middleware/uploadmiddleware";
import { createProject } from "../services/database";
import { IProject } from "../types/database_types";
import { extractNiftiMetadata } from "../utils/nifti_parser";
import {
  isValidFileFormat,
  computeFileHash,
  isS3Storage,
  mapToFileDataType,
} from "../utils/upload_validation";

export const handleUpload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const userId = req.body.userId;

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "No files uploaded." });
  }

  if (!userId) {
    return res.status(400).json({ message: "Missing userId." });
  }

  const uploadedProjects: IProject[] = [];
  const storageMode = process.env.STORAGE_MODE || "local";

  for (const file of files) {
    const { originalname, mimetype, size, path: filePath } = file;

    try {
      if (!isValidFileFormat(originalname)) {
        return res.status(400).json({
          success: false,
          error: "Invalid file format. Only .nii, .nii.gz, or .dcm allowed.",
        });
      }

      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = computeFileHash(fileBuffer);

      // Define storage mode (local or S3)
      const storedPath = isS3Storage(storageMode)
        ? await uploadToS3(file, userId, fileHash)  // Pass userId and fileHash
        : filePath;

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}.nii`;

      const niftiMetadata = await extractNiftiMetadata(filePath);

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
        return res.status(500).json({
          success: false,
          error: result?.message || "An unknown error occurred.",
        });
      }

      uploadedProjects.push(project);
    } catch (error) {
      return res.status(500).json({ message: "Processing failed.", error: (error as Error).message });
    }
  }

  return res.status(200).json({
    message: "Projects uploaded successfully.",
    uploadedProjects,
  });
};
