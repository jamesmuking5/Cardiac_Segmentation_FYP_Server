import express, { Request, Response } from "express";

import { getCurrentToken } from "../services/gpu_auth_client"; // Import the function to get the current token
const router = express.Router();

// DEBUG only - Strictly do not use in production
router.get("/get-gpu_token", async (req: Request, res: Response): Promise<void> => {
    const token = getCurrentToken(); // Get the current token
    if (token) {
        res.status(200).json({ token });
    } else {
        res.status(500).json({ error: "Failed to retrieve GPU token." });
    }
});

// 

export default router;