// File: src/routes/authentication.ts
// Description: Authentication routes for user login, registration, and logout using Passport.js and Express.

import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import { IUserSafe, createUser } from "../services/database"; // CRUD + Auth functions for User
import { isAuthenticated, isAuthAndAdmin } from "../services/passportjs"; // Import Passport.js middleware
import logger from "../services/logger"; // Import logger
import { body, validationResult } from 'express-validator'; // Import express-validator for input validation

const router = express.Router();

router.post("/login",
  // Validate input fields
  [body('username').notEmpty().withMessage('Username is required.'),
  body('password').notEmpty().withMessage('Password is required.')],
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    return next(); // Proceed to authentication if validation passes
  },
  (req: Request, res: Response, next: NextFunction): void => {
    passport.authenticate("local", (err: Error | null, user: IUserSafe, info?: { message: string }) => {
      if (err) {
        logger.error(err);
        res.status(500).json({ message: "Internal error" });
      }
      if (!user) {
        res.status(401).json({ login: false, message: info?.message });
        return; // added return to prevent further execution
      }

      // If user is found, log them in
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          logger.error(loginErr);
          res.status(500).json({ message: "Internal error during login." });
          return; // added return to prevent further execution
        }
        // Successful login, send user info back to client
        logger.info(`User ${user.username} logged in successfully.`);
        res.status(200).json({
          login: true,
          username: user.username,
          role: user.role,
          message: "Login successful.",
        });
      });
    })(req, res, next);
  });

router.post("/register",
  // Validate input fields
  [body('username').notEmpty().withMessage('Username is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
  body('email').isEmail().withMessage('Valid email is required.'),
  body('phone').notEmpty().withMessage('Phone number is required.')],
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) res.status(400).json({ errors: errors.array() });
    next(); // Proceed to registration if validation passes
  },
  async (req: Request, res: Response): Promise<void> => {
    const { username, password, email, phone } = req.body;
    const result = await createUser(username, password, email, phone);
    if (!result.success) res.status(400).json({ register: false, message: result.message });
    if (result.success && result.user) {
      logger.info(`User ${result.user.username} registered successfully.`);
      res.status(201).json({ register: true, username: result.user.username, message: "Registration successful." });
    }
  });

router.post("/logout", (req: Request, res: Response): void => {
  // Check if the user is authenticated before logging out
  if (!req.isAuthenticated()) res.status(401).json({ message: "User not logged in" });
  // Logout the user and destroy the session
  req.logout((err: Error | null) => {
    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error when logging out." });
    }
    res.status(200).json({ message: "Logout successful" });
  });
});

// Middleware-protected route
// This route is only accessible to users who are logged in (i.e., authenticated users). It acts as a basic protected endpoint.
router.get("/protected", isAuthenticated, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are authenticated!" });
});

// Admin-only route
// This route is restricted to admin users only. It ensures the user is logged in and has the admin role.
router.get("/admin", isAuthAndAdmin, (req: Request, res: Response) => {
  res.status(200).json({ message: "You are an admin!" });
});

export default router;