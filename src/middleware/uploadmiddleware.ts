import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request, Response } from "express";
import { FileType } from "../types/database_types";
import logger from '../services/logger';

const serviceLocation = "UploadMiddleware";

dotenv.config();

// Function to create the temporary upload directory if it doesn't exist
const ensureTempUploadDirExists = (): void => {
  const tempUploadDir = "src/temp_upload/";
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    logger.info(`${serviceLocation}: Temporary upload directory created at: ${tempUploadDir}`);
  }
};

// Call the function when this module is loaded
ensureTempUploadDirExists();

// Allowed Extensions and MIME types
const allowedExtensions = [".nii", ".nii.gz", ".dcm"];

// File Type Enum Mappings to MIME types (adjust as per your FileType enum definition)
// This mapping assumes FileType enum values are the expected MIME types.
const fileTypeToMimeMappings: Record<string, string> = {
  [FileType.NIFTI]: "application/octet-stream",
  [FileType.NIFTI_GZ]: "application/x-gzip",
  [FileType.DICOM]: "application/dicom",
};

// Multer Storage Engine (Use local storage unless S3 is enabled)
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    // Always use a temporary local folder first, even for S3 uploads.
    // The actual S3 upload happens in the route handler after multer processing.
    cb(null, "src/temp_upload/");
  },
  filename: (req, file, cb) => {
    try {
      // Sanitize original filename to prevent path traversal attacks
      const sanitizedOriginal = path.basename(file.originalname);

      // Use name from form if provided, otherwise use the original filename
      const userFilename = req.body.name || path.parse(sanitizedOriginal).name;

      let ext = path.extname(sanitizedOriginal).toLowerCase();
      // Special handling for '.nii.gz'
      if (sanitizedOriginal.toLowerCase().endsWith(".nii.gz")) {
        ext = ".nii.gz";
      }

      // Create a unique filename with timestamp
      const timestamp = Date.now();
      const safeName = userFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `${safeName}-${timestamp}${ext}`);
    } catch (error) {
      logger.error(`${serviceLocation}: Error generating filename`, error);
      cb(error as Error, "");
    }
  },
});

// File Filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  let ext = path.extname(file.originalname).toLowerCase();
  // Special handling for '.nii.gz'
  if (file.originalname.toLowerCase().endsWith(".nii.gz")) {
    ext = ".nii.gz";
  }

  if (!allowedExtensions.includes(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file extension: ${ext}. Allowed: ${allowedExtensions.join(', ')}`));
  }

  // MIME type validation based on your FileType enum or direct mapping
  // This part might need adjustment based on how you define/use FileType enum
  // For example, if FileType.NIFTI maps directly to "application/octet-stream"
  let expectedMimeType: string | undefined;
  if (ext === ".nii") expectedMimeType = fileTypeToMimeMappings[FileType.NIFTI];
  else if (ext === ".nii.gz") expectedMimeType = fileTypeToMimeMappings[FileType.NIFTI_GZ];
  else if (ext === ".dcm") expectedMimeType = fileTypeToMimeMappings[FileType.DICOM];

  // The 'file.mimetype' provided by multer might not always be perfect for specialized files like .nii
  // If precise MIME type matching is critical and multer's detection is insufficient,
  // you might need more sophisticated type detection or rely more on the extension.
  // For now, this provides a basic check.
  if (expectedMimeType && file.mimetype !== expectedMimeType) {
    logger.warn(`${serviceLocation}: MIME type mismatch for ${file.originalname}. Expected: ${expectedMimeType}, Got: ${file.mimetype}. Proceeding based on extension.`);
    // You could choose to reject here:
    // return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file mimetype for ${ext}. Expected ${expectedMimeType}, got ${file.mimetype}`));
  }

  cb(null, true);
};

// When in upload route, this middleware will filter files based on the defined storage and file filter.
export const projectUploadFilter = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024 * 1024, // 200 GB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter,
}).fields([
  // Define allowed fields for the multipart form
  { name: 'files', maxCount: 1 },  // File field
  { name: 'name', maxCount: 1 },    // Project name field
  { name: 'description', maxCount: 1 }  // Project description field
]);

// OBJ file filter for GPU server webhook callbacks
const objFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Allow OBJ files for reconstruction results
  if (ext === '.obj') {
    return cb(null, true);
  }
  
  logger.warn(`${serviceLocation}: Rejected file with extension ${ext} in GPU callback. Only .obj files allowed.`);
  return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file extension: ${ext}. Only .obj files allowed for GPU callbacks.`));
};

// Function to create the temporary mesh directory if it doesn't exist
const ensureTempMeshDirExists = (): void => {
  const tempMeshDir = "src/temp_mesh/";
  if (!fs.existsSync(tempMeshDir)) {
    fs.mkdirSync(tempMeshDir, { recursive: true });
    logger.info(`${serviceLocation}: Temporary mesh directory created at: ${tempMeshDir}`);
  }
};

// Call the function when this module is loaded
ensureTempMeshDirExists();

// Multer middleware for GPU server multipart OBJ file callbacks
export const gpuObjUploadFilter = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Use dedicated temporary mesh directory for GPU callback files
      cb(null, "src/temp_mesh/");
    },
    filename: (req, file, cb) => {
      // Preserve original filename from GPU server
      const sanitizedFilename = `gpu_callback_${Date.now()}_${path.basename(file.originalname)}`;
      cb(null, sanitizedFilename);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB limit per OBJ file
    files: 50 // Maximum 50 OBJ files per reconstruction (support multi-frame)
  },
  fileFilter: objFileFilter,
}).any(); // Accept files with any field name from multipart/form-data