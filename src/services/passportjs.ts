import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local"; // for username and pw authentication
import { readUser, authenticateUser, IUserSafe, UserRole } from "./database"; // Import the User model 
import logger from "./logger"; // Import the logger 
import LogError from "../utils/error_logger";
import { Request, Response, NextFunction } from 'express';

const serviceLocation = "PassportJS"; // Location of the service for logging purposes

declare global {
  // Disable the namespace rule just for this block
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Disable the empty object type rule for this necessary augmentation
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends IUserSafe { }
  }
}

// Passport LocalStrategy for Login
passport.use( // register a new strategy for local authentication
  new LocalStrategy(
    // By default, LocalStrategy expects 'username' and 'password'
    async (username, password, done) => { // callback function to handle authentication
      try {
        const result = await authenticateUser(username, password);
        if (!result.success && result.message) return (done(null, false, { message: result.message }));
        if (result.success && result.user) return done(null, result.user);
        throw new Error("Authentication failed in an unexpected way.");
      } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error during authentication.");
        return done(error);
      }
    })
);

// Store only the user ID in the session
passport.serializeUser((user: IUserSafe, done) => {
  logger.info(`${serviceLocation}: Serializing user with ID: ${user._id}`);
  done(null, user._id); // ← store only the user ID
});

// Use the stored user ID to read the user
passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await readUser(id); // fetch by user ID
    if (!result.success) {
      logger.warn(`${serviceLocation}: Deserialization failed for user ID: ${id}`);
      return done(null, false);
    }
    if (result.success && result.user) {
      logger.info(`${serviceLocation}: Deserialized user with ID: ${result.user._id}`);
      return done(null, result.user);
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error during deserialization.");
    return done(error);
  }
});

// Middleware to check if the user is authenticated/logged in
const isAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized. Please log in." });
}

// Middleware to check if the user is authenticated and is an admin
const isAuthAndAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role === UserRole.Admin) next();
  else res.status(403).json({ message: "Forbidden. Admin access required." });
};

// Middleware to check if the user is authenticated and is a user/admin
const isAuthAndUser = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role !== UserRole.Guest) next();
  else res.status(403).json({ message: "Forbidden. Admin or regular user access required." });
};


export { isAuth, isAuthAndAdmin, isAuthAndUser };