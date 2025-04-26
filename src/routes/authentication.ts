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
import LogError  from "../utils/error_logger"; // Import custom error logging utility
import { sessionMiddleware } from "../services/express_app";

const router = express.Router();

router.use((req, res, next) => {
  if (req.path === '/register') {
    // Skip sessionMiddleware for the /register route
    return next();
  }
  // Apply sessionMiddleware for all other routes
  sessionMiddleware(req, res, next);
});

// Logging middleware (runs after sessionMiddleware)
router.use((req, res, next) => {
  console.info(`Requestinauthentiacationoutside to: ${req.path}`);
  console.debug(`Session ID: ${req.sessionID}`);
  console.debug(`User: ${req.user || 'No user in req'}`);
  console.debug(`Full Session: ${req.session ? JSON.stringify(req.session) : 'No session object'}`);
  next();
});

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

        // If user is found, log them in
        return req.logIn(user, (loginErr) => {
          if (loginErr) {
            logger.error(loginErr);
            return res.status(500).json({ message: "Internal error during login." });
          }
        
          // Manually set req.user after login
          req.user = user;
        
          // Log session details after login
          console.info(`Requesniiiit to: /login`);
          console.debug(`Session ID: ${req.sessionID}`);
          console.debug(`User: ${req.user ? JSON.stringify(req.user) : 'No user in req'}`);
          console.debug(`Full Session: ${req.session ? JSON.stringify(req.session) : 'No session object'}`);
        
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

router.post("/logout", isAuth, (req: Request, res: Response): void => {
  // Logout the user and destroy the session
  req.logout((err: Error | null) => {
    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error when logging out." });
    } else {
      console.info(`User ${req.user?.username} logged out successfully.`);
      // Log session details after logout
      console.info(`solosolosolo to: /logout`);
      console.debug(`Session ID: ${req.sessionID}`);
      console.debug(`User: ${req.user ? JSON.stringify(req.user) : 'No user in req'}`);
      console.debug(`Full Session: ${req.session ? JSON.stringify(req.session) : 'No session object'}`);

      req.session?.destroy((destroyErr) => {
        if (destroyErr) {
          logger.error('Error destroying session:', destroyErr);
          res.status(500).json({ message: "Error destroying session." });
        } else {
          res.clearCookie('connect.sid'); // Clear session cookie
          res.status(200).json({ message: "Logout successful." });
        }
      });
    }
  });
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