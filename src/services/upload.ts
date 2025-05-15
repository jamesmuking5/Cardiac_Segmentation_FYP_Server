// File: src/services/upload.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import { Request, Response } from "express";
import fs from "fs";
import { uploadToS3 } from "../services/s3_handler";
import { createProject, readProject } from "../services/database";
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
  // With fields configuration, files are now in req.files.files
  const files = req.files && 'files' in req.files ? req.files.files : [];
  const userId = (req.user as any)?._id;

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No files uploaded."
    });
  }

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Missing userId."
    });
  }

  // Get user-provided fields
  const projectName = req.body.name || '';
  const description = req.body.description || '';

  logger.info(`${serviceLocation}: Processing upload with name: "${projectName}", description: "${description.substring(0, 30)}${description.length > 30 ? '...' : ''}"`);

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

      // Compute file hash early
      const fileBuffer = fs.readFileSync(filePath);
      const filehash = computeFileHash(fileBuffer);

      // NEW: Check if a project with this file hash already exists for this user
      const existingProjectResult = await readProject(
        undefined,  // projectId - not searching by ID
        userId,     // userId - filter by current user
        undefined,  // name - not searching by name
        undefined,  // description - not searching by description
        undefined,  // isSaved - not filtering by saved status
        undefined,  // filename - not searching by filename
        undefined,  // filetype - not filtering by file type
        undefined,  // filesize - not filtering by file size
        filehash,    // filehash - filter by the computed hash
        undefined,  // datatype - not filtering by data type
        undefined,  // dimensions - not filtering by dimensions
        undefined,  // voxelSize - not filtering by voxel size
        undefined,  // creationDate - not filtering by creation date
      );

      // If a project with this file hash already exists for this user
      if (existingProjectResult.success && existingProjectResult.projects && existingProjectResult.projects.length > 0) {
        logger.warn(`${serviceLocation}: File with hash ${filehash} already exists for user ${userId}`);

        // Clean up the temporary file
        fs.unlinkSync(filePath);

        return res.status(409).json({
          success: false,
          error: "A project with this file already exists.",
          existingProject: {
            id: existingProjectResult.projects[0]._id,
            name: existingProjectResult.projects[0].name
          }
        });
      }

      // Continue with file processing if no duplicate was found
      logger.info(`${serviceLocation}: No duplicate found for file hash ${filehash}. Proceeding with upload.`);

      let fileExtension = path.extname(originalname).toLowerCase();
      if (originalname.toLowerCase().endsWith(".nii.gz")) {
        fileExtension = ".nii.gz";
      }
      const newFileName = `${userId}_${filehash}${fileExtension}`;
      newFilePath = path.join(path.dirname(filePath), newFileName);
      fs.renameSync(filePath, newFilePath);

      const generatedFilename = `${userId}_${filehash}${fileExtension}`;

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
        s3KeyPrefix = `source_nifti/${userId}/`;
        // Upload only once
        niiFileS3Url = await uploadToS3(fs.createReadStream(newFilePath), userId, filehash, fileExtension, s3KeyPrefix);
        storedPath = `s3://${process.env.AWS_BUCKET_NAME}/${s3KeyPrefix}`;
      } else {
        storedPath = newFilePath;
        // For local storage, create a local URL or path format
        niiFileS3Url = `file://${newFilePath}`;
      }

      // Create a temporary directory for JPEG files
      jpegOutputDir = path.join(__dirname, '..', 'temp_jpeg', `${userId}_${filehash}`);
      fs.mkdirSync(jpegOutputDir, { recursive: true });

      // Construct the command to execute the Python script to convert to JPEGs
      const pythonScriptPath = path.join(__dirname, '..', 'python', 'convert_to_jpeg.py');
      const pythonCommand = `python "${pythonScriptPath}" "${newFilePath}" "${jpegOutputDir}" "${(actualTarFilePath || "").replace('.tar', '')}" "${userId}" "${String(filehash)}"`;
      try {
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(pythonCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
              LogError(error as Error, serviceLocation, `Error extracting JPEG conversion script - ${stderr}.`);
              reject(new Error(`JPEG conversion failed: ${stderr}`));
            }
            logger.info(`${serviceLocation}: JPEG conversion script stdout:`, stdout);
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
          tarFileS3Url = await uploadToS3(tarFile, userId, filehash, '.tar', s3KeyPrefix); // Upload TAR to the user's folder
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
        filehash: filehash,
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

  return res.status(200).json({
    message: "Projects uploaded and processed successfully.",
    projects: uploadedProjects.map(p => ({
      id: p.userid,
      name: p.name,
      originalfilename: p.originalfilename
    }))
  });
};