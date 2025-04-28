// File: src/middleware/uploadmiddleware.ts

import AWS from "aws-sdk";
import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request } from "express";

dotenv.config();

// Setup AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// Upload to S3
export const uploadToS3 = async (file: Express.Multer.File, userId: string, fileHash: string) => {
  const fileStream = fs.createReadStream(file.path);

  // Filename should be in the format: userID_SHA256
  const generatedFilename = `${userId}_${fileHash}.nii`;  // Use SHA256 as part of filename

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: generatedFilename,  // Use the generated filename
    Body: fileStream,
    ContentType: file.mimetype,
    ACL: "public-read",
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
const allowedMimeTypes = [
  "application/octet-stream",
  "application/dicom",
  "application/x-nifti",
  "application/gzip",
];

// Multer Storage Engine
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "src/temp_upload/");
  },
  filename: (req, file, cb) => {
    const userFilename = req.body.filename || path.parse(file.originalname).name;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${userFilename}${ext}`);
  },
});

// File Filter (Validation)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype;

  if (!allowedExtensions.includes(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Invalid file extension"));
  }
  if (!allowedMimeTypes.includes(mimetype)) {
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

// Additional Error Handler (NEW)
export const uploadErrorHandler = (err: any, req: Request, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: "Unexpected upload error" });
  }
  next();
};
