import express, { Request, Response } from "express";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
try {
    // override: true allows to override cached environment variables
    dotenv.config({ path: path.join(__dirname, "../../.env"), override: true }); 
  } catch (error) {
    logger.error(
      `Database: Error loading .env file. Please check the file path and permissions.`
    );
  }
  
// Create express app
const app = express();

// Import Winston Logger
import logger from "./services/logger";
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