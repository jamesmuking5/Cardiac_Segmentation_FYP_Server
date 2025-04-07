import express from "express";
import { upload } from "../middleware/uploadmiddleware"; // Importing the multer middleware
import { handleUpload } from "../controllers/uploadcontroller"; // Importing the controller

const router = express.Router();

// RESTful API route to handle file uploads
// Using upload.any() to handle multiple files or folders
router.post("/upload", upload.any(), async (req, res, next) => {
    try {
        await handleUpload(req, res);  // Calling the controller method to handle file upload logic
    } catch (error) {
        next(error); // Passing errors to the global error handler
    }
});

router.get("/upload", (req, res) => {
    res.send("This route only supports POST for file uploads.");
});

export default router;