// File: src/services/s3_handler.ts
// Description: This module handles AWS S3 interactions, including uploading files, deleting objects, and extracting S3 keys from URLs.

import { S3Client, PutObjectCommand, PutObjectCommandInput, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { projectModel } from "../services/database";
import logger from "./logger"; // Import your logger
import fs from "fs";

const serviceLocation = "S3Handler";

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
      contentType = 'application/x-gzip';
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

export const cleanupUserS3Storage = async (userId: string): Promise<void> => {
  const serviceLocation = "S3Handler - Cleanup User S3 Storage";
  try {
    logger.info(`${serviceLocation}: Starting S3 cleanup for user ${userId}.`);

    // Step 1: Find all projects for the user
    const projects = await projectModel.find({ userid: userId }).lean();
    if (!projects || projects.length === 0) {
      logger.info(`${serviceLocation}: No projects found for user ${userId}.`);
      return;
    }

    // Step 2: Collect all S3 keys from the projects
    const s3Keys: string[] = [];
    for (const project of projects) {
      if (project.originalfilepath) {
        const key = extractS3KeyFromUrl(project.originalfilepath);
        if (key) s3Keys.push(key);
      }
      if (project.extractedfolderpath) {
        const key = extractS3KeyFromUrl(project.extractedfolderpath);
        if (key) s3Keys.push(key);
      }
    }

    // Step 3: Delete all S3 files
    for (const key of s3Keys) {
      const success = await deleteFromS3(key);
      if (!success) {
        logger.warn(`${serviceLocation}: Failed to delete S3 file with key ${key}.`);
      }
    }

    logger.info(`${serviceLocation}: S3 cleanup completed for user ${userId}.`);
  } catch (error) {
    logger.error(`${serviceLocation}: Error during S3 cleanup for user ${userId}:`, error);
  }
};