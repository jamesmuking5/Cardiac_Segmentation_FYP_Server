import AWS from "aws-sdk";
import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request } from "express";
import { FileType } from "../types/database_types"; // Import your FileType enum

dotenv.config();

// Setup AWS S3 if STORAGE_MODE is s3
let s3: AWS.S3 | null = null;
if (process.env.STORAGE_MODE === "s3") {
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    region: process.env.AWS_REGION!,
  });
}

// Upload to S3 function
export const uploadToS3 = async (file: fs.ReadStream, userId: string, fileHash: string, fileExtension: string) => {
  if (!s3) throw new Error("AWS S3 is not configured.");

  const generatedFilename = `source_nifti/${userId}_${fileHash}${fileExtension}`; // Ensure it saves to the 'source_nifti/' prefix.

  let contentType: string;
  switch (fileExtension) {
    case '.nii':
      contentType = 'application/octet-stream';
      break;
    case '.nii.gz':
      contentType = 'application/gzip';
      break;
    case '.dcm':
      contentType = 'application/dicom';
      break;
    default:
      contentType = 'application/octet-stream'; // Fallback to a generic type
      break;
  }

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: generatedFilename,
    Body: file,
    ContentType: contentType,
  };

  try {
    const s3UploadResult = await s3.upload(params).promise();
    return s3UploadResult.Location;  // Return the S3 file location
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Error uploading to S3: ${error.message}`
        : "Error uploading to S3: Unknown error occurred"
    );
  }
};

// Allowed Extensions and MIME types
const allowedExtensions = [".nii", ".nii.gz", ".dcm"];

// File Type Enum Mappings
const fileTypeMappings: Record<string, string> = {
  ".nii": FileType.NIFTI,
  ".nii.gz": FileType.NIFTI_GZ,
  ".dcm": FileType.DICOM,
};

// Multer Storage Engine (Use local storage unless S3 is enabled)
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    if (process.env.STORAGE_MODE === "local") {
      cb(null, "src/temp_upload/");
    } else {
      cb(null, "src/temp_upload/"); // Temporary folder before S3 upload
    }
  },
  filename: (req, file, cb) => {
    const userFilename = req.body.filename || path.parse(file.originalname).name;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userFilename}${ext}`);
  },
});

// File Filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  let ext = path.extname(file.originalname).toLowerCase();
  if (file.originalname.toLowerCase().endsWith(".nii.gz")) {
    ext = ".nii.gz";
  }

  const mimetype = file.mimetype;

  if (!allowedExtensions.includes(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Invalid file extension"));
  }

  const expectedMimeType = fileTypeMappings[ext];
  if (mimetype !== expectedMimeType) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Invalid file mimetype"));
  }

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
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: "Unexpected upload error" });
  }
  next();
};
