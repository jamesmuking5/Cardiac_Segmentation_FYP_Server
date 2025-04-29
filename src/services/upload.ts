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
import path from "path";

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

      // Compute the SHA-256 hash of the file
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = computeFileHash(fileBuffer);

      // Rename the original file to include the SHA-256 hash
      const fileExtension = path.extname(originalname); // .nii or .dcm
      const newFileName = `${userId}_${fileHash}${fileExtension}`;
      const newFilePath = path.join(path.dirname(filePath), newFileName);

      // Rename the file to the new file name
      try {
        fs.renameSync(filePath, newFilePath);
      } catch (err) {
        if (err instanceof Error) {
          console.log(`Error renaming file: ${err.message}`);
        } else {
          console.log("Error renaming file: Unknown error occurred.");
        }
        return res.status(500).json({ message: `Error renaming file: ${(err as Error).message}` });
      }

      // Define storage mode (local or S3)
      const storedPath = isS3Storage(storageMode)
        ? await uploadToS3(fs.createReadStream(newFilePath), userId, fileHash)  // Pass userId and fileHash
        : newFilePath;

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}.nii`;  // Rename logic for project

      const niftiMetadata = await extractNiftiMetadata(newFilePath);

      // Declare and assign the variables for S3 URLs before using them
      let niiFileS3Url = "";
      let tarFileS3Url = "";

      // Upload both .nii and .tar.gz files to S3
      const niiFile = fs.createReadStream(newFilePath);
      niiFileS3Url = await uploadToS3(niiFile, userId, fileHash);  // Upload .nii file

      const tarFilePath = `${userId}_${fileHash}.tar.gz`;
      const tarCommand = `tar -czf ${tarFilePath} -C ${path.dirname(newFilePath)} ${newFileName}`;

      const tarResult = await new Promise((resolve, reject) => {
        require("child_process").exec(tarCommand, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(`Error compressing file: ${stderr}`);
          } else {
            resolve(stdout);
          }
        });
      });

      console.log(`Tar file created at: ${tarFilePath}`);

      const tarFile = fs.createReadStream(tarFilePath);
      tarFileS3Url = await uploadToS3(tarFile, userId, fileHash);  // Upload .tar.gz file

      // Now, save project details
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
        originalfilepath: niiFileS3Url,
        extractedfolderpath: tarFileS3Url,
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

      // Clean up local temp files after upload
      if (fs.existsSync(tarFilePath)) {
        fs.unlinkSync(tarFilePath);
      } else {
        console.log(`File at ${tarFilePath} not found.`);
      }

      if (fs.existsSync(newFilePath)) {
        fs.unlinkSync(newFilePath);
      } else {
        console.log(`File at ${newFilePath} not found.`);
      }

      return res.status(200).json({
        message: "Projects uploaded and processed successfully.",
        uploadedProjects,
        niiFileS3Url, // S3 URL for .nii file
        tarFileS3Url, // S3 URL for .tar.gz file
      });

    } catch (error) {
      return res.status(500).json({ message: "Processing failed.", error: (error as Error).message });
    }
  }

  return res.status(200).json({
    message: "Projects uploaded and processed successfully.",
    uploadedProjects,
  });
};
