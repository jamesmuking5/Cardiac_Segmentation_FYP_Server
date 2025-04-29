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

export const handleUpload = async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const userId = (req.user as any)?._id;

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

    let newFilePath: string | undefined;
    let jpegOutputDir: string | undefined;
    let tarFilePath: string | undefined;

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

      const storedPath = isS3Storage(storageMode)
        ? await uploadToS3(fs.createReadStream(newFilePath), userId, fileHash, fileExtension)
        : newFilePath;

      const projectId = new mongoose.Types.ObjectId();
      const generatedFilename = `${userId}_${projectId.toHexString()}.nii`;

      let niftiMetadata: any = {};
      try {
        niftiMetadata = await extractNiftiMetadata(newFilePath);
      } catch (error: any) {
        console.error("Failed to extract NIfTI metadata:", error.message);
        niftiMetadata = {};
      }

      let niiFileS3Url = "";
      let tarFileS3Url = "";

      const niiFile = fs.createReadStream(newFilePath);
      niiFileS3Url = await uploadToS3(niiFile, userId, fileHash, fileExtension);

      // Create a temporary directory for JPEG files
      jpegOutputDir = path.join(__dirname, '..', 'temp_jpeg', `${userId}_${fileHash}`);
      fs.mkdirSync(jpegOutputDir, { recursive: true });

      // Construct the command to execute the Python script to convert to JPEGs
      const pythonScriptPath = path.join(__dirname, '..', 'python', 'convert_to_jpeg.py');
      const pythonCommand = `python "${pythonScriptPath}" "${newFilePath}" "${jpegOutputDir}" "${(tarFilePath || "").replace('.tar', '')}" "${userId}" "${projectId.toHexString()}"`;
      try {
        console.log("Executing command:", pythonCommand);
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(pythonCommand, (error, stdout, stderr) => {
            if (error) {
              console.error("Error executing JPEG conversion script:", error);
              console.error("JPEG conversion script stderr:", stderr);
              reject(new Error(`JPEG conversion failed: ${stderr}`));
            }
            console.log("JPEG conversion script stdout:", stdout);
            resolve({ stdout, stderr });
          });
        });

        // Create the .tar archive of the JPEG directory
        const tarFileName = `${userId}_${fileHash}_jpegs.tar`;
        tarFilePath = path.join(__dirname, '..', 'temp_jpeg', tarFileName);
        const tarCommand = `tar -cf "${tarFilePath}" -C "${jpegOutputDir}" .`;

        await new Promise((resolve, reject) => {
          exec(tarCommand, (error, stdout, stderr) => {
            if (error) {
              console.error("Error creating tar:", error);
              console.error("Tar stderr:", stderr);
              reject(new Error(`Error creating tar: ${stderr}`));
            }
            console.log("Tar stdout:", stdout);
            resolve({ stdout, stderr });
          });
        });

        const tarFile = fs.createReadStream(tarFilePath);
        tarFileS3Url = await uploadToS3(tarFile, userId, fileHash, '.tar');

        // No need to clean up here as it will be done in the finally block

      } catch (error: any) {
        console.error("Error during JPEG conversion or archiving:", error.message);
        tarFileS3Url = "";
      } finally {
        // Clean up temporary files
        if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
          fs.rmSync(jpegOutputDir, { recursive: true, force: true });
        }
        if (tarFilePath && fs.existsSync(tarFilePath)) {
          fs.rmSync(tarFilePath, { force: true });
        }
        if (newFilePath && fs.existsSync(newFilePath)) {
          fs.unlinkSync(newFilePath);
        }
      }

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

      return res.status(200).json({
        message: "Projects uploaded and processed successfully.",
        uploadedProjects,
        niiFileS3Url, // S3 URL for .nii file
        tarFileS3Url, // S3 URL for .tar file
      });

    } catch (error) {
      return res.status(500).json({ message: "Processing failed.", error: (error as Error).message });
    } finally {
      // Ensure cleanup happens even if there's an error
      if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
        fs.rmSync(jpegOutputDir, { recursive: true, force: true });
      }
      if (tarFilePath && fs.existsSync(tarFilePath)) {
        fs.rmSync(tarFilePath, { force: true });
      }
      if (newFilePath && fs.existsSync(newFilePath)) {
        fs.unlinkSync(newFilePath);
      }
    }
  }

  return res.status(200).json({
    message: "Projects uploaded and processed successfully.",
    uploadedProjects,
  });
};