// File: src/routes/authentication.ts
// Description: Authentication routes for user login, registration, and logout using Passport.js and Express.

import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import { IUser, IUserSafe, UserRole, createUser, readUser, updateUser, deleteUser } from "../services/database"; // CRUD + Auth functions for User
import { isAuth, isAuthAndAdmin, isAuthAndUser } from "../services/passportjs"; // Import Passport.js middleware
import logger from "../services/logger"; // Import logger
import validateFields from "../utils/field_validation"; // Import reusable validation middleware
import { validationResult } from 'express-validator'; // Import express-validator for input validation
import { v4 as uuidv4 } from 'uuid'; // Import UUID for generating unique guest IDs

const router = express.Router();
const serviceLocation = "API(Authentication)"; // Service location for logging

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
    // Create new IUser object
    const newUser: IUser = {
      username,
      password,
      email,
      phone,
      role: UserRole.User, // Default role for new users
    };
    const result = await createUser(newUser);
    if (!result.success) {
      res.status(400).json({ register: false, message: result.message });
      return;
    }
    if (result.success && result.user) {
      logger.info(`${serviceLocation}: ${result.user.username} registered successfully.`);
      res.status(201).json({
        register: true,
        message: "Registration successful.",
        user: result.user,
      });
      return;
    }
  }
);

router.post("/login",
  [validateFields[0], validateFields[1]],  // Username and password validation
  (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ login: false, errors: errors.array() });
    } else {
      next();
    }
  },
  (req: Request, res: Response, next: NextFunction): void => {
    passport.authenticate("local", (err: Error | null, user: IUserSafe, info?: { message: string }) => {
      if (err) {
        logger.error(`${serviceLocation}: Authentication error: ${err}`);
        return res.status(500).json({ message: "Internal error" });
      }
      if (!user) {
        return res.status(401).json({ login: false, message: info?.message });
      }

      return req.logIn(user, (loginErr) => {
        if (loginErr) {
          logger.error(`${serviceLocation}: Login error: ${loginErr}`);
          return res.status(500).json({ message: "Internal error during login." });
        }

        logger.info(`${serviceLocation}: User ${user.username} logged in successfully.`);
        return res.status(200).json({
          login: true,
          username: user.username,
          role: user.role,
          message: "Login successful.",
        });
      });
    })(req, res, next);
  }
);

router.post("/logout", isAuth, async (req: Request, res: Response): Promise<void> => {
  // Store user info before logout for potential guest cleanup
  const user = req.user;
  const isGuest = user && typeof user.username === 'string' && user.username.startsWith('guest_');
  const userId = user?._id;
  const username = user?.username;

  // Log the user attempting to log out
  if (user) {
    logger.info(`${serviceLocation}: User ${username || userId} attempting to log out.`);
  } else {
    logger.info(`${serviceLocation}: Authenticated user attempting to log out (username/ID not available on req.user).`);
  }

  // Handle the logout process
  req.logout(async (err: Error | null) => {
    logger.info(`${serviceLocation}: req.logout() callback executed.`);

    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error when logging out." });
      return; // Stop further execution
    }

    // If this is a guest user, delete their account after logout
    if (isGuest && userId) {
      try {
        logger.info(`${serviceLocation}: Cleaning up guest user account: ${username}`);

        // Here you would add your S3 cleanup code
        // For example:
        // await cleanupUserS3Storage(userId);

        // Delete the user which will cascade delete all associated records
        const deleteResult = await deleteUser(userId);

        if (deleteResult.success) {
          logger.info(`${serviceLocation}: Guest user ${username} (${userId}) and all associated data deleted successfully.`);
        } else {
          logger.warn(`${serviceLocation}: Failed to delete guest user ${username} (${userId}): ${deleteResult.message}`);
        }
      } catch (cleanupError) {
        logger.error(`${serviceLocation}: Error during guest cleanup for ${username} (${userId}): ${cleanupError}`);
        // Continue with response even if cleanup fails - the user is still logged out
      }
    }

    // Add a log to indicate successful session destruction
    logger.info(`${serviceLocation}: Session successfully destroyed after logout.`);

    // Send response indicating successful logout
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

    // Create a new guest user with the generated credentials
    const newGuestUser: IUser = {
      username,
      password,
      email,
      phone,
      role: UserRole.Guest, // Default role for guest users
    };
    const result = await createUser(newGuestUser);

    if (!result.success || !result.user) {
      logger.error(`${serviceLocation}: Guest registration failed: ${result.message}`);
      res.status(500).json({ login: false, message: "Failed to create guest account." });
      return;
    }

    if (!result.user) {
      logger.error(`${serviceLocation}: Guest login failed: User is undefined.`);
      res.status(500).json({ message: "Guest login failed." });
      return;
    }

    return req.logIn(result.user, (err) => {
      if (err) {
        logger.error(`${serviceLocation}: Guest login error: ${err}`);
        res.status(500).json({ message: "Guest login failed." });
        return;
      }

      logger.info(`${serviceLocation}: Guest user ${result.user!.username} logged in successfully.`);
      return res.status(200).json({
        login: true,
        guest: true,
        username: result.user!.username,
        role: result.user!.role,
        message: "Logged in as guest.",
      });
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Guest Login - Unexpected error during guest login: ${error}`);
    res.status(500).json({ message: "Unexpected error during guest login." });
    return;
  }
});

// Update route for user information
router.post("/update",
  // Validate the input fields for update
  validateFields,
  isAuthAndUser, async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user && req.user._id) {
        const userid = req.user._id;
        // Only allow updates to username, email, and phone (not password or role)
        const { username, email, phone } = req.body;

        // Update the user information in the database
        const result = await updateUser(userid, { username, email, phone });

        if (!result.success) {
          res.status(400).json({ update: false, message: result.message });
          return;
        }

        logger.info(`${serviceLocation}: User ${userid} updated successfully.`);
        res.status(200).json({
          update: true,
          message: "User information updated successfully.",
          user: result.user,
        });
      }
    }
    catch (error: unknown) {
      logger.error(`${serviceLocation}: Error during user update: ${error}`);
      res.status(500).json({ message: "Internal error during user update." });
    }
  });

// Fetch user information route
router.get("/fetch", isAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    // Extract user ID from the authenticated session
    const userId = String(req.user?._id);

    // Fetch user information from the database
    const result = await readUser({ _id: userId });

    if (!result.success || !result.user) {
      res.status(404).json({ fetch: false, message: "User not found." });
      return;
    }

    logger.info(`${serviceLocation}: Fetched user info for ${result.user.username}.`);
    res.status(200).json({
      fetch: true,
      message: "User information fetched successfully.",
      user: result.user,
    });
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error fetching user info: ${error}`);
    res.status(500).json({ fetch: false, message: "Internal error during user fetch." });
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