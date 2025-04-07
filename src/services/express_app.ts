import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import authenticationRoute from '../routes/authentication';
import logger from './logger';

// Create express app instance
const app = express();

/* Middleware */
// Apply essential middleware like parsing JSON bodies
app.use(express.json());
// Configure express-session
// Note: Ensure SESSION_SECRET is loaded before this runs (e.g., via dotenv in index.ts)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'default_secret', // Use a secure secret
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);
// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions

/* Routes */
// Mount authentication routes
app.use('/auth', authenticationRoute);

// Root Route
app.get('/', (req: Request, res: Response) => { // Use _req if req is unused
  logger.info('Root route accessed');
  res.send('Hello, TypeScript Server!');
});

// Export the configured app instance
export { app };