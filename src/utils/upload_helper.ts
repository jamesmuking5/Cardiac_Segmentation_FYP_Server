// FIle: src/utils/upload_helper.ts
// Description: Helper functions for file upload processing including file format validation, hash generation, and storage mode checks.

import { FileDataType } from "../types/database_types";
import fs from "fs";
import crypto from "crypto";

/**
 * Validates the file format by checking if it ends with `.nii` or `.nii.gz`.
 * Supports uncompressed and gzipped NIfTI formats.
 *
 * @param filename - The name of the file to validate.
 * @returns True if the file format is valid, false otherwise.
 */
export function isValidFileFormat(filename: string): boolean {
  return filename.endsWith(".nii") || filename.endsWith(".nii.gz");
}

/**
 * Computes a SHA-256 hash of the given file buffer.
 * Commonly used for deduplication or file integrity checks.
 *
 * @param fileBuffer - The file data as a Node.js Buffer.
 * @returns The hexadecimal SHA-256 hash of the file.
 */
export function computeFileHash(fileBuffer: Buffer): string {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * Checks whether the current storage mode is set to local storage.
 *
 * @param storageMode - The configured storage mode (e.g., "local", "s3").
 * @returns True if the storage mode is "local", false otherwise.
 */
export function isLocalStorage(storageMode: string): boolean {
  return storageMode === "local";
}

/**
 * Checks whether the current storage mode is set to AWS S3.
 *
 * @param storageMode - The configured storage mode (e.g., "local", "s3").
 * @returns True if the storage mode is "s3", false otherwise.
 */
export function isS3Storage(storageMode: string): boolean {
  return storageMode === "s3";
}

/**
 * Maps a given string representing a NIfTI data type to the corresponding FileDataType enum.
 * Falls back to FileDataType.UNKNOWN if the type is unrecognized.
 *
 * @param datatype - The string representation of the NIfTI data type (e.g., "float32").
 * @returns The corresponding FileDataType enum value.
 */
export function mapToFileDataType(datatype: string): FileDataType {
    switch (datatype.toLowerCase()) {
      case "float32":
        return FileDataType.FLOAT32;
      case "uint16":
        return FileDataType.UINT16;
      case "uint8":
        return FileDataType.UINT8;
      default:
        return FileDataType.UNKNOWN;
    }
  }
  