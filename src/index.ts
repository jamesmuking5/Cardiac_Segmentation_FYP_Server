import express, { Response } from "express";
import dotenv from "dotenv";
import path from "path";

import session from "express-session"; // Import express-session
import passport from "passport"; // Import Passport.js


import authRoutes from "./routes/auth_service"; // Import the auth routes


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



// Add the auth routes
app.use("/auth", authRoutes); // Mount the auth routes at the /auth path



// Configure express-session 
// When a user logs in, a session is created and a session ID is sent to the client via a cookie
app.use(
  session({
    secret: process.env.SESSION_SECRET || "default_secret", // Use a secure secret in production
    resave: false, // Prevents resaving session if nothing has changed
    saveUninitialized: false, // Prevents saving uninitialized sessions
    cookie: {
      secure: process.env.NODE_ENV === "production", // Use secure cookies in production
      httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions


/* Routes */
app.get("/", (res: Response) => {
  res.send("Hello, TypeScript Server!");
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
  });
}

// Export the app for testing
export { app };