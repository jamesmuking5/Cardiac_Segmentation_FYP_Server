import express, { Request, Response } from "express";
import dotenv from "dotenv";

// Create express app
const app = express();

// Import Winston Logger
const logger = require("./services/logger");
// Import MongoDB Connection and connect to database
const { connectToDatabase } = require("./services/database");
connectToDatabase();

// Load environment variables
const PORT = process.env.PORT || 3000;

/* Middleware */
app.use(express.json());

/* Routes */
app.get("/", (req: Request, res: Response) => {
    res.send("Hello, TypeScript Server!");
});

// Start the server
app.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
});