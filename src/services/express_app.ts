import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import { RedisStore } from 'connect-redis';
import { redisClient } from './redis';
import authenticationRoute from '../routes/authentication';
import uploadRoute from '../routes/uploadroutes';
import debugRoute from '../routes/debug_routes';
import gpuStatusRoute from '../routes/gpu_status';
import logger from './logger';
import cors from 'cors';

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


// Get environment type
const envType = process.env.NODE_ENV || 'development'; // Default to 'development' if not set


// Configure express-session with Redis store
// Note: Ensure SESSION_SECRET is loaded before this runs (e.g., via dotenv in index.ts)

// the middleware runs for every incoming request to your application, including /register, /login, and /logout. 
// When a request comes in, the express-session middleware will look for a session cookie.
// If one exists, it will try to load the corresponding session from your Redis store and make it available on req.session. 
// If no session cookie exists, it will prepare a new, uninitialized session object on req.session.
app.use(
  session({
    store: redisStore,
    secret: process.env.SESSION_SECRET || 'default_secret',
    resave: false,

    // This setting tells express-session not to save a session to the store (Redis) 
    // if it's new and hasn't been modified during the request.

    // the /register route handles creating a user in your database. 
    // However, it does not modify req.session or call req.logIn. 
    // Because saveUninitialized: false is set, even though the session middleware runs for /register, 
    // a session will not be saved to Redis by this route handler. 
    // A session ID might be generated and sent back as a cookie to the client,
    // but the corresponding session data won't be stored in Redis until something is saved to req.session.
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
)

// Enable CORS for all routes (adjust as needed for production)
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5371', // Adjust as needed
  credentials: true, // Allow credentials (cookies) to be sent
}));


// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions

/* Routes */
// Root Route
app.get('/', (req: Request, res: Response) => { // Use _req if req is unused
  logger.info('Root route accessed');
  res.json({ message: 'Welcome to the VisHeart API!' });
});

// Mount authentication routes under '/auth'
app.use('/auth', authenticationRoute);
app.use('/', uploadRoute); // File Upload route


// Debug Route
if (envType === 'development') {
  app.use(debugRoute); // Mount debug routes only in development mode
  logger.info('Debug routes mounted for development environment');
}

// Status Routes (mount under '/status')
app.use('/status', gpuStatusRoute); // Mount GPU status routes

// Export the configured app instance
export { app };