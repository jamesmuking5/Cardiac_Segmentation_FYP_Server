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

// Store only the username in the session
passport.serializeUser((user: IUserSafe, done) => {
  logger.info(`${serviceLocation}: Serializing user: ${user.username}`);
  done(null, user.username); // ← store only username
});

// Use the stored username to read the user
passport.deserializeUser(async (username: string, done) => {
  logger.info('is me pr11111oblem?');
  try {
    const result = await readUser(username); // ← always fetch by username
    logger.info('is me 123456789?');
    if (!result.success) {  
      logger.warn(`${serviceLocation}: Deserialization failed for user: ${username}`);
      return done(null, false);
    }
    logger.info(result.success);
    if (result.success && result.user) {
      logger.info(`${serviceLocation}: Deserialized user: ${result.user.username}`);
      return done(null, result.user);
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error during deserialization.");
    return done(error);
  }
});


// Middleware to check if the user is authenticated/logged in
const isAuth = (req: Request, res: Response, next: NextFunction): void => {
  logger.info('is me probleoiuytm?');
  if (req.isAuthenticated()) next();
  res.status(401).json({ message: "Unauthorized. Please log in." });
}

// Middleware to check if the user is authenticated and is an admin
const isAuthAndAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.isAuthenticated() && req.user.role === UserRole.Admin) next();
  else res.status(403).json({ message: "Forbidden. Admin access required." });
};

export { isAuth, isAuthAndAdmin };