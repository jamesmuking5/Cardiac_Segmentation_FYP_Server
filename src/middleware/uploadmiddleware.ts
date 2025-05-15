import { S3Client, PutObjectCommand, PutObjectCommandInput, DeleteObjectCommand } from "@aws-sdk/client-s3";
import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request, Response, NextFunction } from "express";
import { FileType } from "../types/database_types";
import logger from '../services/logger';

const serviceLocation = "UploadMiddleware";

dotenv.config();

// Function to create the temporary upload directory if it doesn't exist
const ensureTempUploadDirExists = () => {
  const tempUploadDir = "src/temp_upload/";
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    logger.info(`${serviceLocation}: Temporary upload directory created at: ${tempUploadDir}`);
  }
};

// Call the function when this module is loaded
ensureTempUploadDirExists();

// Setup AWS S3 v3 client if STORAGE_MODE is s3
let s3Client: S3Client | null = null;
if (process.env.STORAGE_MODE === "s3") {
  if (!process.env.AWS_REGION) {
    logger.error(`${serviceLocation}: AWS_REGION environment variable is not set. S3 client cannot be initialized.`);
    // You might want to throw an error here or handle this case appropriately
  } else {
    s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    logger.info(`${serviceLocation}: S3Client initialized for region: ${process.env.AWS_REGION}`);

    // Check if S3 client is configured correctly - using an IIFE to allow await
    (async () => {
      try {
        const testKey = `_test/${Date.now()}.txt`;
        await s3Client!.send(new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: testKey,
          Body: 'test'
        }));

        // Delete the test object right away
        await s3Client!.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: testKey
        }));

        logger.info(`${serviceLocation}: S3 client connection verified with write test.`);
      } catch (error) {
        logger.error(`${serviceLocation}: Error verifying S3 client connection:`, error);
        s3Client = null;
      }
    })().catch(err => {
      // This catch handles any unhandled promise rejections from the IIFE itself
      logger.error(`${serviceLocation}: Unhandled error in S3 client verification:`, err);
    });
  }
}

// Add a function to delete an S3 object for cleanup
export const deleteFromS3 = async (objectKey: string): Promise<boolean> => {
  if (!s3Client || !process.env.AWS_BUCKET_NAME) {
    logger.error(`${serviceLocation}: Cannot delete from S3: Client or bucket not configured`);
    return false;
  }

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: objectKey,
    }));
    logger.info(`${serviceLocation}: Successfully deleted ${objectKey} from S3 bucket ${process.env.AWS_BUCKET_NAME}`);
    return true;
  } catch (error) {
    logger.error(`${serviceLocation}: Error deleting ${objectKey} from S3:`, error);
    return false;
  }
};

// Extract S3 key from a full S3 URL
export const extractS3KeyFromUrl = (s3Url: string): string | null => {
  try {
    const url = new URL(s3Url);
    let key = url.pathname;
    if (key.startsWith('/')) {
      key = key.substring(1);
    }
    return key;
  } catch (error) {
    logger.error(`${serviceLocation}: Error extracting key from S3 URL: ${s3Url}`, error);
    return null;
  }
};

// Modified Upload to S3 function to include a key prefix using AWS SDK v3
export const uploadToS3 = async (
  fileStream: fs.ReadStream,
  userId: string,
  fileHash: string,
  fileExtension: string,
  keyPrefix: string,
): Promise<string> => {
  if (!s3Client) {
    logger.error(`${serviceLocation}: AWS S3 client is not configured. Cannot upload to S3.`);
    throw new Error("AWS S3 client is not configured.");
  }
  if (!process.env.AWS_BUCKET_NAME) {
    logger.error(`${serviceLocation}: AWS_BUCKET_NAME environment variable is not set. Cannot upload to S3.`);
    throw new Error("AWS_BUCKET_NAME is not configured.");
  }

  const generatedFilename = `${keyPrefix}${userId}_${fileHash}${fileExtension}`;

  let contentType: string;
  switch (fileExtension.toLowerCase()) { // ensure consistent casing for extension check
    case '.nii':
      contentType = 'application/octet-stream';
      break;
    case '.nii.gz':
      contentType = 'application/gzip';
      break;
    case '.dcm':
      contentType = 'application/dicom';
      break;
    case '.tar':
      contentType = 'application/x-tar';
      break;
    default:
      contentType = 'application/octet-stream'; // Fallback to a generic type
      break;
  }

  const commandInput: PutObjectCommandInput = {
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: generatedFilename,
    Body: fileStream,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(commandInput);

  try {
    await s3Client.send(command);
    logger.info(`${serviceLocation}: Successfully uploaded ${generatedFilename} to S3 bucket ${process.env.AWS_BUCKET_NAME}`);

    // Construct the S3 file location URL
    const region = process.env.AWS_REGION;
    const bucketName = process.env.AWS_BUCKET_NAME;

    // Handle potential regional differences in S3 URL format, especially for us-east-1
    let location;
    if (region === "us-east-1") {
      location = `https://${bucketName}.s3.amazonaws.com/${generatedFilename}`;
    } else {
      location = `https://${bucketName}.s3.${region}.amazonaws.com/${generatedFilename}`;
    }
    return location;
  } catch (error) {
    // Close the file stream in case of an error
    if (!fileStream.closed && !fileStream.destroyed) {
      fileStream.destroy();
    }
    
    logger.error(`${serviceLocation}: Error uploading to S3: ${generatedFilename}`, error);
    throw new Error(
      error instanceof Error
        ? `Error uploading to S3: ${error.message}`
        : "Error uploading to S3: Unknown error occurred"
    );
  }
};

// Allowed Extensions and MIME types
const allowedExtensions = [".nii", ".nii.gz", ".dcm"];

// File Type Enum Mappings to MIME types (adjust as per your FileType enum definition)
// This mapping assumes FileType enum values are the expected MIME types.
const fileTypeToMimeMappings: Record<string, string> = {
  [FileType.NIFTI]: "application/octet-stream",
  [FileType.NIFTI_GZ]: "application/gzip",
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

// Multer configuration with fields specified
export const upload = multer({
  storage,
  limits: { 
    fileSize: 200 * 1024 * 1024 * 1024, // 200 GB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter,
}).fields([
  // Define allowed fields for the multipart form
  { name: 'files', maxCount: 10 },  // File field
  { name: 'name', maxCount: 1 },    // Project name field
  { name: 'description', maxCount: 1 }  // Project description field
]);

// Error Handler for Multer
export const uploadErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // Cleanup any temp files if there was an error
  if (req.files) {
    const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
    files.forEach(file => {
      if (fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
          logger.info(`${serviceLocation}: Cleaned up temporary file ${file.path} after upload error`);
        } catch (cleanupError) {
          logger.error(`${serviceLocation}: Failed to clean up temporary file ${file.path}`, cleanupError);
        }
      }
    });
  }

  if (err instanceof multer.MulterError) {
    logger.error(`${serviceLocation}: Multer upload error:`, err);
    return res.status(400).json({ 
      success: false,
      error: err.message, 
      code: err.code 
    });
  }
  
  if (err) {
    logger.error(`${serviceLocation}: Unexpected upload error:`, err);
    return res.status(500).json({ 
      success: false,
      error: "Unexpected upload error", 
      message: err.message 
    });
  }
  
  next();
};