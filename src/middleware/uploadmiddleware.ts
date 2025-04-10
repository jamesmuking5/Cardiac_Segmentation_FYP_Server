// File: src/middleware/uploadmiddleware.ts
// Description: Middleware for handling file uploads using Multer with disk storage.

import AWS from "aws-sdk";
import multer, { StorageEngine } from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, 
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, 
  region: process.env.AWS_REGION
});

// Function to upload files to S3
export const uploadToS3 = async (file: Express.Multer.File) => {
  const fileStream = fs.createReadStream(file.path);  // Read the file from local disk

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME!,   // S3 Bucket name
    Key: `${Date.now()}-${path.basename(file.originalname)}`,  // S3 object key (unique name)
    Body: fileStream,  // File content
    ContentType: file.mimetype,  // File MIME type
    ACL: "public-read"  // Make the file publicly accessible
  };

  try {
    // Upload the file to S3
    const s3UploadResult = await s3.upload(params).promise();

    // Return the S3 URL for the uploaded file
    return s3UploadResult.Location;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Error uploading to S3: ${error.message}`);
    } else {
      throw new Error("Error uploading to S3: Unknown error occurred");
    }
  }
};

//Configure Multer storage engine for handling file uploads.
const storage: StorageEngine = multer.diskStorage({
  destination: function (req: Express.Request, file, cb) {
    cb(null, "src/uploads/"); // Directory to temporarily store uploaded files
  },
  filename: function (req: Express.Request, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`); // Generate unique filename with original extension
  }
});

// Exported multer upload handler configured with disk storage.
export const upload = multer({ storage });