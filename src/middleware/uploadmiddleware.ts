import multer from "multer";
import path from "path";

// Storage configuration for Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "src/uploads/"); // Files will be temporarily stored in this folder
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Generate a unique filename
    }
});

export const upload = multer({ storage });