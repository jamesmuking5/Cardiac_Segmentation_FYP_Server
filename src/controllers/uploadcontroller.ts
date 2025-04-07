import { Request, Response } from "express";
import fs from "fs";
import crypto from "crypto"; // Import the crypto module
import { createFile } from "../services/database"; // Importing the createFile function

// Controller to handle file upload logic
export const handleUpload = async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];

    // Check if files are uploaded
    if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded." });
    }

    const uploadedFilesDetails = [];

    // Get userId or guestId from body
    const userId = req.body.userId;
    const guestId = req.body.guestId;

    // Decide which ID to use
    const createdBy = userId || guestId;

    // If neither is provided, return an error
    if (!createdBy) {
        return res.status(400).json({ message: "Missing userId or guestId in request." });
    }

    for (const file of files) {
        const localPath = file.path; // Path to the locally stored file

        try {
            // Step 1: Generate the file hash
            const fileBuffer = fs.readFileSync(localPath);
            const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // Step 2: Save metadata to the database
            const { originalname, mimetype, size } = file;

            const result = await createFile(
                originalname,            // Filename
                localPath,               // File path
                mimetype,                // File type
                fileHash,                // SHA-256 hash
                size,                    // File size in bytes
                createdBy,               // Created by (userId or guestId)
                undefined                // Optional description
            );

            if (!result.success) {
                return res.status(500).json({ message: "Error saving file metadata", error: result.error });
            }

            uploadedFilesDetails.push({
                originalName: file.originalname,
                storedAs: file.filename,
                size: file.size,
                path: localPath
            });

            // Optionally delete local file after processing
            // fs.unlinkSync(localPath);

        } catch (error) {
            return res.status(500).json({ message: "Error processing the file", error });
        }
    }

    return res.status(200).json({
        message: "Files uploaded and processed successfully.",
        uploadedBy: userId ? `userId: ${userId}` : `guestId: ${guestId}`,
        uploadedFiles: uploadedFilesDetails
    });
};
