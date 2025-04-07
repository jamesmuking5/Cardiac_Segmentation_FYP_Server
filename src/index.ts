// File: src/index.ts
// Description: Main application entry point. Handles server startup and database connection.

import session from "express-session"; // Import express-session
import passport from "passport"; // Import Passport.js

// Service Location
const serviceLocation = "Main";

import logger from './services/logger'; // Import Winston Logger

// Service Location for logging within this file
const serviceLocation = 'Main';

// Load environment variables
try {
  dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });
} catch (error: unknown) {
  logger.error(`${serviceLocation}: Failed to load environment variables. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  // process.exit(1); // Optionally exit if critical error occurs
}

// Import necessary modules AFTER dotenv
import { app } from './services/express_app'; // Import the configured Express app
import LogError from './utils/error_logger'; // Import error logging utility
import { connectToDatabase } from './services/database'; // Import DB connection function

// Get PORT from environment variables (now guaranteed to be loaded)
const PORT = process.env.PORT || 3000;

/* Middleware */
app.use(express.json());

// Import file upload routes and middlewares
import uploadRouter from "./routes/uploadroutes"; // Import the router for the file upload routes

// Add the file upload routes
app.use("/api", uploadRouter); // The upload route will now be accessible at /api/uploadz

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

// Note: The `export const app = express();` line is removed from here.
// All middleware and route setup is now handled in app.ts.