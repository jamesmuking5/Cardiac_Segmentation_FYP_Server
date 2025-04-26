import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import { RedisStore } from 'connect-redis';
import { redisClient } from './redis';
import authenticationRoute from '../routes/authentication';
import logger from './logger';

// Create express app instance
const app = express();

/* Middleware */
// Apply essential middleware like parsing JSON bodies
app.use(express.json());

// Setup Redis session store
const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'visheart:',
});

// Define session configuration - We'll apply this selectively in the router
// Export it so the router can use the same config
export const sessionMiddleware = session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || 'default_secret', // Ensure this is securely managed
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something stored
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true, // Prevent client-side JS from reading the cookie
    maxAge: 1000 * 60 * 60 * 24, // Session duration: 1 day
  },
});

// Initialize Passport.js
app.use(passport.initialize());

// app.use(passport.session()); // Enable persistent login sessions

app.use((req, res, next) => {
  console.info(`Requestexternal inexperessapp to: ${req.path}`);
  console.debug(`Session ID: ${req.sessionID}`);
  console.debug(`User: ${req.user || 'No user in req'}`);
  console.debug(`Full Session: ${req.session ? JSON.stringify(req.session) : 'No session object'}`);
  next();
});

/* Routes */
// Mount authentication routes under '/auth'
app.use('/auth', authenticationRoute);

// Root Route
app.get('/', (req: Request, res: Response) => { // Use _req if req is unused
  logger.info('Root route accessed');
  res.send('Hello, TypeScript Server!');
});

// Export the configured app instance
export { app };