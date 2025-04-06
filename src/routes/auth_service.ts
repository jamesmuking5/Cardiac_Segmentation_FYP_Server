import express, { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import passport from "passport";
import { userModel } from "../services/database"; // Import User model
import { isAuthenticated, isAuthAndAdmin } from "../services/passportjs"; // Import Passport.js middleware
import logger from "../services/logger"; // Import logger

const router = express.Router();

router.post("/login", (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate(
    "local",
    (err: Error | null, user: any, info: { message: string } | undefined) => {
      if (err) {
        logger.error(err);
        return res.status(500).json({ message: "Internal error" });
      }

      if (!user) {
        return res.status(401).json({ login: false, message: info?.message });
      }

      req.logIn(user, (err) => {
        if (err) {
          logger.error(err);
          return res.status(500).json({ message: "Internal error" });
        }
        logger.info(`User ${user.username} logged in successfully.`);
        return res.status(200).json({
          login: true,
          username: user.username,
          role: user.role,
          message: "Login successful",
        });
      });

      // Final return to ensure there's always a response
      return;
    }
  )(req, res, next);
});

router.post("/register", async (req: Request, res: Response): Promise<any> => {
  try {
    const { username, password, email, phone } = req.body;

    if (!username || !password || !email || !phone) {
      return res.status(400).json({
        register: false,
        message: "Missing required fields: username, password, email, phone",
      });
    }

    const existingUser = await userModel.findOne({
      $or: [{ username }, { email }, { phone }],
    });
    if (existingUser) {
      return res.status(400).json({
        register: false,
        message: "User with the provided username, email, or phone already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new userModel({
      username,
      password: hashedPassword,
      email,
      phone,
      role: "user",
    });

    await newUser.save();
    logger.info(`User ${username} registered successfully.`);
    return res.status(201).json({ register: true, message: "Registration successful" });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ register: false, message: "Internal error" });
  }
});

router.post("/logout", (req: Request, res: Response): void => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ message: "User not logged in" });
    return;
  }

  req.logout((err: Error | null) => {
    if (err) {
      logger.error(err);
      res.status(500).json({ message: "Internal error" });
      return;
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