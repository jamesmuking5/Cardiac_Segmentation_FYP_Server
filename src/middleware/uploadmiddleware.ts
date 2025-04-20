// File: src/middleware/uploadmiddleware.ts
// Description: Middleware for handling file uploads using Multer with disk storage.

import multer, { StorageEngine } from "multer";
import path from "path";
import { Request } from "express";

//Configure Multer storage engine for handling file uploads.
const storage: StorageEngine = multer.diskStorage({
  destination: function (req: Request, file, cb) {
    cb(null, "src/uploads/"); // Directory to temporarily store uploaded files
  },
  filename: function (req: Request, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`); // Generate unique filename with original extension
  }
});

// Exported multer upload handler configured with disk storage.
export const upload = multer({ storage });
