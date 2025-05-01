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
import { exec } from "child_process";
import logger from "./logger";
import LogError from "../utils/error_logger";

const serviceLocation = "Upload"

export const handleUpload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const userId = (req.user as any)?._id;

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "No files uploaded." });
  }

  if (!userId) {
    return res.status(400).json({ message: "Missing userId." });
  }

  const projectName = req.body.projectName;
  const description = req.body.description;

  const uploadedProjects: IProject[] = [];
  const storageMode = process.env.STORAGE_MODE || "local";

  for (const file of files) {
    const { originalname, mimetype, size, path: filePath } = file;

    let newFilePath: string | undefined;
    let jpegOutputDir: string | undefined;
    let actualTarFilePath: string | undefined;
    let storedPath: string | undefined;

    try {
      if (!isValidFileFormat(originalname)) {
        return res.status(400).json({
          success: false,
          error: "Invalid file format. Only .nii, .nii.gz, or .dcm allowed.",
        });
      }

      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = computeFileHash(fileBuffer);
      let fileExtension = path.extname(originalname).toLowerCase();
      if (originalname.toLowerCase().endsWith(".nii.gz")) {
        fileExtension = ".nii.gz";
      }
      const newFileName = `${userId}_${fileHash}${fileExtension}`;
      newFilePath = path.join(path.dirname(filePath), newFileName);
      fs.renameSync(filePath, newFilePath);

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}${fileExtension}`;

      let niftiMetadata: any = {};
      try {
        niftiMetadata = await extractNiftiMetadata(newFilePath);
      } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error extracting NIfTI metadata.");
        niftiMetadata = {};
      }

      let niiFileS3Url = "";
      let tarFileS3Url = "";
      let s3KeyPrefix = "";

      if (isS3Storage(storageMode)) {
        s3KeyPrefix = `source_nifti/${userId}/`; // Create the folder prefix
        niiFileS3Url = await uploadToS3(fs.createReadStream(newFilePath), userId, fileHash, fileExtension, s3KeyPrefix); // Upload original
        storedPath = `s3://${process.env.AWS_BUCKET_NAME}/${s3KeyPrefix}`; // Set basepath to the S3 folder
      } else {
        storedPath = newFilePath; // For local storage
      }

      const niiFile = fs.createReadStream(newFilePath);
      niiFileS3Url = await uploadToS3(niiFile, userId, fileHash, fileExtension, s3KeyPrefix); // Re-upload for originalfilepath

      // Create a temporary directory for JPEG files
      jpegOutputDir = path.join(__dirname, '..', 'temp_jpeg', `${userId}_${fileHash}`);
      fs.mkdirSync(jpegOutputDir, { recursive: true });

      // Construct the command to execute the Python script to convert to JPEGs
      const pythonScriptPath = path.join(__dirname, '..', 'python', 'convert_to_jpeg.py');
      const pythonCommand = `python "${pythonScriptPath}" "${newFilePath}" "${jpegOutputDir}" "${(actualTarFilePath || "").replace('.tar', '')}" "${userId}" "${projectId.toHexString()}"`;
      try {
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(pythonCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
              LogError(error as Error, serviceLocation, `Error extracting JPEG conversion script - ${stderr}.`);
              reject(new Error(`JPEG conversion failed: ${stderr}`));
            }
            logger.info("JPEG conversion script stdout:", stdout);
            const tarPathMatch = stdout.match(/TAR_FILE_PATH:(.*)/);
            if (tarPathMatch && tarPathMatch[1]) {
              actualTarFilePath = tarPathMatch[1].trim();
            }
            resolve({ stdout, stderr });
          });
        });

        if (!actualTarFilePath) {
          LogError(new Error("TAR file path not found in stdout"), serviceLocation, "TAR file path extraction failed.");
          tarFileS3Url = "";
          // Handle the error appropriately

        } else {
          const tarFile = fs.createReadStream(actualTarFilePath);
          tarFileS3Url = await uploadToS3(tarFile, userId, fileHash, '.tar', s3KeyPrefix); // Upload TAR to the user's folder
        }

      } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error during JPEG conversion or archiving.");
        tarFileS3Url = "";
      } finally {
        // Clean up based on actual paths if needed
        if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
          fs.rmSync(jpegOutputDir, { recursive: true, force: true });
        }
        if (actualTarFilePath && fs.existsSync(actualTarFilePath)) {
          fs.rmSync(actualTarFilePath, { force: true });
        }
        if (newFilePath && fs.existsSync(newFilePath)) {
          fs.unlinkSync(newFilePath);
        }
      }

      const project: IProject = {
        userid: String(userId),
        name: projectName || originalname,
        originalfilename: originalname,
        description: description || "",
        isSaved: true,
        filename: generatedFilename,
        filetype: mimetype as any,
        filesize: size,
        filehash: fileHash,
        basepath: storedPath!,
        originalfilepath: niiFileS3Url,
        extractedfolderpath: tarFileS3Url,
        datatype: mapToFileDataType(niftiMetadata.datatype),
        dimensions: {
          width: niftiMetadata.dimensions.width ?? 0,
          height: niftiMetadata.dimensions.height ?? 0,
          slices: niftiMetadata.dimensions.slices ?? 0,
          frames: niftiMetadata.dimensions.frames ?? 0,
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
        project.description,
        project.isSaved,
        project.filename,
        project.filetype,
        project.filesize,
        project.filehash,
        project.basepath,
        project.originalfilepath,
        project.extractedfolderpath,
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
    } finally {
      // Ensure cleanup happens even if there's an error
      if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
        fs.rmSync(jpegOutputDir, { recursive: true, force: true });
      }
      if (actualTarFilePath && fs.existsSync(actualTarFilePath)) {
        fs.rmSync(actualTarFilePath, { force: true });
      }
      if (newFilePath && fs.existsSync(newFilePath)) {
        fs.unlinkSync(newFilePath);
      }
    }
  }

  return res.status(200).json({ message: "Projects uploaded and processed successfully." });
};