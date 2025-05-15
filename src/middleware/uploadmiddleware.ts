// AWS SDK v3 imports
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage"; // For managed uploads with streams

import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request } from "express";
import { FileType } from "../types/database_types"; // Import your FileType enum

dotenv.config();

// Function to create the temporary upload directory if it doesn't exist
const ensureTempUploadDirExists = () => {
  const tempUploadDir = "src/temp_upload/";
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    console.log(`Temporary upload directory created at: ${tempUploadDir}`);
  }
};

ensureTempUploadDirExists();

// Setup AWS S3 Client (v3) if STORAGE_MODE is s3
let s3Client: S3Client | null = null;
if (process.env.STORAGE_MODE === "s3") {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_REGION || !process.env.AWS_BUCKET_NAME) {
    console.error("AWS S3 configuration is missing in environment variables.");
    // Potentially throw an error or handle this state appropriately
  } else {
    s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
}

// Modified Upload to S3 function using AWS SDK v3
export const uploadToS3 = async (
  fileStream: fs.ReadStream, // Changed parameter name for clarity
  userId: string,
  fileHash: string,
  fileExtension: string,
  keyPrefix: string = ""
) => {
  if (!s3Client) {
    throw new Error("AWS S3 Client is not configured or configuration is incomplete.");
  }
  if (!process.env.AWS_BUCKET_NAME) {
    throw new Error("AWS_BUCKET_NAME is not defined in environment variables.");
  }

  const generatedFilename = `${keyPrefix}${userId}_${fileHash}${fileExtension}`;

  let contentType: string;
  switch (fileExtension.toLowerCase()) { // Ensure consistent casing for extension
    case '.nii':
      contentType = 'application/octet-stream'; // NIfTI is often application/octet-stream
      break;
    case '.nii.gz':
      contentType = 'application/gzip'; // Or application/octet-stream if served as binary
      break;
    case '.dcm':
      contentType = 'application/dicom';
      break;
    default:
      contentType = 'application/octet-stream'; // Fallback
      break;
  }

  try {
    const parallelUploads3 = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: generatedFilename,
        Body: fileStream,
        ContentType: contentType,
      },
      // Optional: configure queue size, part size for large files
      // queueSize: 4,
      // partSize: 1024 * 1024 * 5, // 5MB
    });

    // Optional: Listen to progress events
    // parallelUploads3.on("httpUploadProgress", (progress) => {
    //   console.log(progress);
    // });

    const result = await parallelUploads3.done();
    // The result for `Upload` from `@aws-sdk/lib-storage` includes Location
    // but it might be typed as `CompleteMultipartUploadCommandOutput` which doesn't directly show Location.
    // However, Location is part of the output for successful uploads.
    // You can construct it manually if needed or rely on the S3 response.
    // A common way to construct is: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${generatedFilename}`
    // For simplicity, let's assume `result.Location` is available or can be cast.
    // If result.Location is not directly available, you might need to type assert or construct it.
    // For example, if result is of type `$metadata` and `ETag`, `Bucket`, `Key` are present:
    // return `https://${result.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${result.Key}`;
    // However, @aws-sdk/lib-storage's Upload.done() typically returns an object with a Location property.
    return (result as any).Location || `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${generatedFilename}`;

  } catch (error) {
    console.error("Error during S3 upload:", error); // Log the actual error
    throw new Error(
      error instanceof Error
        ? `Error uploading to S3: ${error.message}`
        : "Error uploading to S3: Unknown error occurred"
    );
  }
};

// --- REST OF YOUR CODE REMAINS LARGELY THE SAME ---

// Allowed Extensions and MIME types
const allowedExtensions = [".nii", ".nii.gz", ".dcm"];

// File Type Enum Mappings - Assuming FileType enum values are strings like 'NIFTI', 'NIFTI_GZ', 'DICOM'
// This mapping is for your internal logic, not directly for S3 ContentType which is set in uploadToS3
const fileTypeEnumMappings: Record<string, FileType> = {
  ".nii": FileType.NIFTI,
  ".nii.gz": FileType.NIFTI_GZ,
  ".dcm": FileType.DICOM,
};

// This mapping seems to be intended for validating against Express.Multer.File.mimetype
// Note: mimetypes can be tricky and vary.
// '.nii' might be 'application/octet-stream'
// '.nii.gz' might be 'application/gzip' or 'application/x-gzip' or 'application/octet-stream'
// '.dcm' is usually 'application/dicom'
const expectedMimeTypesForValidation: Record<string, string[]> = {
  ".nii": ['application/octet-stream', 'application/x-nifti'], // Add variants if necessary
  ".nii.gz": ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
  ".dcm": ['application/dicom'],
};


// Multer Storage Engine
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    // Always use a temporary local folder first
    cb(null, "src/temp_upload/");
  },
  filename: (req, file, cb) => {
    // Use a unique name for temp storage to avoid collisions, or keep original
    // For simplicity, using original name with a timestamp prefix might be safer for temp files
    // const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // cb(null, uniquePrefix + '-' + file.originalname);
    // Or, stick to your logic if body.filename is reliable at this stage
    const userFilename = req.body.filename || path.parse(file.originalname).name;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userFilename}${ext}`);
  },
});

// File Filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  let ext = path.extname(file.originalname).toLowerCase();
  // Handle double extensions like .nii.gz
  if (file.originalname.toLowerCase().endsWith(".nii.gz")) {
    ext = ".nii.gz";
  }

  if (!allowedExtensions.includes(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file extension: ${ext}. Allowed: ${allowedExtensions.join(', ')}`));
  }

  // Validate mimetype
  const allowedMimeTypesForExt = expectedMimeTypesForValidation[ext];
  if (!allowedMimeTypesForExt || !allowedMimeTypesForExt.includes(file.mimetype)) {
      console.warn(`Mismatched mimetype for extension ${ext}. Expected one of: ${allowedMimeTypesForExt?.join('/') || 'N/A'}, Got: ${file.mimetype}`);
      // Depending on strictness, you might allow or deny here.
      // For now, let's be a bit lenient and only warn, or you can enforce:
      // return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file mimetype: ${file.mimetype} for extension ${ext}. Expected: ${allowedMimeTypesForExt?.join('/')}`));
  }

  // If you have a FileType enum to set on `req` for later use:
  // (req as any).fileTypeEnum = fileTypeEnumMappings[ext];

  cb(null, true);
};

// Multer Middleware
export const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 * 1024 }, // 200 GB
  fileFilter,
});

// Error Handler for Multer
export const uploadErrorHandler = (err: any, req: Request, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  if (err) { // Other errors that might have been passed to cb in fileFilter
    return res.status(400).json({ error: err.message || "Unexpected upload error" });
  }
  next();
};