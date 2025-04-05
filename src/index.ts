import express, { Response } from "express";
import dotenv from "dotenv";
import path from "path";

// Service Location
const serviceLocation = "Main";

// Import Winston Logger
import logger from "./services/logger";
import LogError from "./utils/error_logger";

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });
} catch (error: unknown) {
  LogError(error as Error, serviceLocation, "Failed to load environment variables.");
}

// Create express app
const app = express();

// Import MongoDB Connection and connect to database
import { connectToDatabase } from "./services/database";
// Connect to MongoDB in async function
(async (): Promise<void> => {
  await connectToDatabase();
})().catch((error: unknown) => {
  LogError(error as Error, serviceLocation, "Error during database connection.");
});

// Load environment variables
const PORT = process.env.PORT || 3000;

/* Middleware */
app.use(express.json());

/* Routes */
app.get("/", (res: Response) => {
  res.send("Hello, TypeScript Server!");
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
});