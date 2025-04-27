// File: src/routes/authentication.ts
// Description: Authentication routes for user login, registration, and logout using Passport.js and Express.

import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import { IUserSafe, createUser } from "../services/database"; // CRUD + Auth functions for User
import { isAuth, isAuthAndAdmin } from "../services/passportjs"; // Import Passport.js middleware
import logger from "../services/logger"; // Import logger
import validateFields from "../utils/field_validation"; // Import reusable validation middleware
import { body, validationResult } from 'express-validator'; // Import express-validator for input validation
import { v4 as uuidv4 } from 'uuid'; // Import UUID for generating unique guest IDs

const router = express.Router();

router.post("/register",
  // Use all validation fields for registration
  validateFields,
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // If validation fails, return a 400 response with error details
      res.status(400).json({ register: false, errors: errors.array() });
    } else {
      next(); // Proceed to registration if validation passes
    }
  },
  async (req: Request, res: Response): Promise<void> => {
    const { username, password, email, phone } = req.body;
    const result = await createUser(username, password, email, phone);
    if (!result.success) {
      res.status(400).json({ register: false, message: result.message });
      return;
    }
    if (result.success && result.user) {
      logger.info(`User ${result.user.username} registered successfully.`);
      res.status(201).json({
        register: true,
        username: result.user.username,
        message: "Registration successful.",
      });
      return;
    }
  }
);

router.post("/login",
  // Use only username and password validation for login
  [validateFields[0], validateFields[1]], // Username and password validation
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // If validation fails, return a 400 response with error details
      res.status(400).json({ login: false, errors: errors.array() });
    } else {
      next(); // Proceed to authentication if validation passes
    }
  },
  (req: Request, res: Response, next: NextFunction): void => {
    passport.authenticate("local",
      (err: Error | null, user: IUserSafe, info?: { message: string }) => {
        if (err) {
          logger.error(err);
          return res.status(500).json({ message: "Internal error" });
        }
        if (!user) {
          return res.status(401).json({ login: false, message: info?.message });
        }

        // This is where the session becomes initialized and is saved to the store. 
        // If user is found, log them in

        // Passport's req.logIn method serializes the user (using your passport.serializeUser function 
        // which saves the user ID to req.session), and express-session, detecting that req.session has been modified, 
        // will then save the session data (including the user ID) to your Redis store. 
        // So, a session is created and saved to Redis upon successful login.
        return req.logIn(user, (loginErr) => {
          if (loginErr) {
            logger.error(loginErr);
            return res.status(500).json({ message: "Internal error during login." });
          }
        
          logger.info(`User ${user.username} logged in successfully.`);
          return res.status(200).json({
            login: true,
            username: user.username,
            role: user.role,
            message: "Login successful.",
          });
        });
      }
    )(req, res, next);
  }
);

router.post("/logout", (req: Request, res: Response): void => {
  // Check if the user is authenticated before logging out
  if (!req.isAuthenticated()) {
    res.status(401).json({ message: "User not logged in" });
    return; // Stop further execution
  }

  // Log the user attempting to log out (if available)
  if (req.user) {
    logger.info(`User ${req.user.username || req.user._id} attempting to log out.`); // <--- Added debug log
  } else {
      logger.info("Authenticated user attempting to log out (username/ID not available on req.user)."); // <--- Added debug log
  }

  // Your /logout route calls req.logout(...). Passport's req.logout method is designed to clear 
  // the login state from req.session and terminate the session. When req.logout is used, 
  // it typically destroys the session in the session store. 
  // So, the session data is destroyed in Redis when a user logs out via this route.
  // Logout the user and destroy the session
  req.logout((err: Error | null) => {
    logger.info("req.logout() callback executed.");

    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error when logging out." });
      return; // Stop further execution
    }
    
    // Add a log to indicate successful session destruction
    logger.info("Session successfully destroyed after logout.");

    // Send a single response indicating successful logout
    res.status(200).json({ message: "Logout successful." });
  });
});

// Guest login route
router.post("/guest", async (req: Request, res: Response): Promise<void> => {
  try {
    const guestID = uuidv4();
    const username = `guest_${guestID}`;
    const password = `pass_${uuidv4()}`;
    const email = `${guestID}@guestmail.com`;
    const phone = `000-${Math.floor(10000000 + Math.random() * 90000000)}`;

    const result = await createUser(username, password, email, phone);

    if (!result.success || !result.user) {
      logger.error(`Guest registration failed: ${result.message}`);
      res.status(500).json({ login: false, message: "Failed to create guest account." });
      return;
    }

    if (!result.user) {
      logger.error("Guest login failed: User is undefined.");
      res.status(500).json({ message: "Guest login failed." });
      return;
    }

    return req.logIn(result.user, (err) => {
      if (err) {
        logger.error(`Guest login error: ${err}`);
        res.status(500).json({ message: "Guest login failed." });
        return;
      }

      logger.info(`Guest user ${result.user!.username} logged in successfully.`);
      return res.status(200).json({
        login: true,
        guest: true,
        username: result.user!.username,
        role: result.user!.role,
        message: "Logged in as guest.",
      });
    });
  } catch (error: unknown) {
    logger.error(`Guest Login - Unexpected error during guest login: ${error}`);
    res.status(500).json({ message: "Unexpected error during guest login." });
    return;
  }
});

// Middleware-protected route
// This route is only accessible to users who are logged in (i.e., authenticated users). It acts as a basic protected endpoint.
router.get("/protected", isAuth, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are authenticated!" });
});

// Admin-only route
// This route is restricted to admin users only. It ensures the user is logged in and has the admin role.
router.get("/admin", isAuthAndAdmin, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are an admin!" });
});

export default router;