import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local"; // for username and pw authentication
import { readUser, authenticateUser, IUserSafe, UserRole } from "./database"; // Import the User model // the mongodb model for users, used to query the database
import logger from "./logger"; // Import the logger // for logging - debugging and error tracking
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

// Serialize user (store full user details (except password) into session) and called when a user is authenticated/logged in successfully
passport.serializeUser((user: any, done) => {
  // Logs the username of the user being serialized for debugging purposes
  logger.info(`${serviceLocation}: Serializing user: ${user.username}`);
  done(null, user); // Save only the user ID in the session
});

// Deserialize user (retrieve user info from session)
passport.deserializeUser(async (username: string, done) => {
  try {
    const result = await readUser(username);
    if (!result.success && result.message) {
      logger.warn(`${serviceLocation}: Deserialization failed - ${result.message}`);
      return done(null, false);
    }
    if (result.user) {
      logger.info(`${serviceLocation}: Deserialized user: ${result.user.username}`);
      return done(null, result.user);
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error during deserialization.");
    return done(error);
  }
});

// Middleware to check if the user is authenticated/logged in
const isAuthenticated = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated()) next();
  else res.status(401).json({ message: "Unauthorized. Please log in." });
}

// Middleware to check if the user is authenticated and is an admin
const isAuthAndAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role === UserRole.Admin) next();
  else res.status(403).json({ message: "Forbidden. Admin access required." });
};

export { isAuthenticated, isAuthAndAdmin };