import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local"; // for username and pw authentication
import bcrypt from "bcrypt"; // for password hashing
import { userModel } from "./database"; // Import the User model // the mongodb model for users, used to query the database
import logger from "./logger"; // Import the logger // for logging - debugging and error tracking

// Passport LocalStrategy for Login
passport.use( // register a new strategy for local authentication
  new LocalStrategy(
    // By default, LocalStrategy expects 'username' and 'password'
    { usernameField: "username", passwordField: "password" },
    async (username, password, done) => { // callback function to handle authentication
      try {
        // Find the user's username in the database
        const user = await userModel.findOne({ username });
        if (!user) {
          return done(null, false, { message: "User does not exist" });
        }

        // Compares the provided password with the hashed password stored in the database
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return done(null, false, { message: "Incorrect password" });
        }

        // If everything is valid, return the user object
        return done(null, user);
      } catch (error) {
        logger.error(`Error during authentication: ${error}`);
        return done(error);
      }
    }
  )
);

// Called when a user is authenticated/logged in successfully
// Serialize user (store user ID in session)
passport.serializeUser((user: any, done) => {
    // Logs the username of the user being serialized for debugging purposes
  logger.info(`Serializing user: ${user.username}`);
  done(null, user._id); // Save only the user ID in the session
});


// Deserialize user (retrieve user info from session)
passport.deserializeUser(async (id, done) => {
  try {
    const user = await userModel.findById(id);
    if (!user) {
      logger.error(`User with ID ${id} not found during deserialization.`);
      return done(null, false);
    }
    logger.info(`Deserializing user: ${user.username}`);
    done(null, user);
  } catch (error) {
    logger.error(`Error during deserialization: ${error}`);
    done(error);
  }
});

// Middleware to check if the user is authenticated/logged in
const isAuthenticated = (req: any, res: any, next: any) => {
  if (req.isAuthenticated()) { // provided by passportjs to determine if the user is authenticated
    return next();
  }
  return res.status(403).json({ message: "Unauthorized." });
};

// Middleware to check if the user is authenticated and is an admin
const isAuthAndAdmin = (req: any, res: any, next: any) => {
  if (req.isAuthenticated() && req.user.role === "admin") {
    return next();
  }
  return res
    .status(403)
    .json({ message: "Unauthorized. Only for Administrator roles." });
};

export { isAuthenticated, isAuthAndAdmin };