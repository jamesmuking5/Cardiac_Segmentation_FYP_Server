import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import { RedisStore } from 'connect-redis';
import { redisClient } from './redis';
import authenticationRoute from '../routes/authentication';
import uploadRoute from '../routes/uploadroutes';
import webhookRoute from '../routes/webhook_routes';
import debugRoute from '../routes/debug_routes';
import gpuStatusRoute from '../routes/gpu_status';
import logger from './logger';
import cors from 'cors';

// Create express app instance
const app = express();
const serviceLocation = "ExpressApp"; // For logging context

/* Middleware */
// Apply essential middleware like parsing JSON bodies
app.use(express.json({limit: '100mb'})); // Increase limit for large JSON payloads

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

// Enable CORS for all routes
let corsOriginConfig: cors.CorsOptions['origin'];

if (envType === 'development') {
  corsOriginConfig = true; // Allow all origins in development
  logger.info(`${serviceLocation}: CORS configured to allow all origins (development mode).`);
} else {
  const allowedOrigins: string[] = [];
  if (process.env.CORS_ORIGIN) {
    allowedOrigins.push(process.env.CORS_ORIGIN);
  }
  if (process.env.GPU_SERVER_ORIGIN_FOR_CALLBACK) {
    allowedOrigins.push(process.env.GPU_SERVER_ORIGIN_FOR_CALLBACK);
  }

  if (allowedOrigins.length > 0) {
    corsOriginConfig = allowedOrigins;
    logger.info(`${serviceLocation}: CORS configured for specific origins: ${allowedOrigins.join(', ')} (production mode).`);
  } else {
    // Fallback if no specific origins are set for production.
    // This makes CORS restrictive by default in production if no origins are specified.
    corsOriginConfig = false;
    logger.warn(`${serviceLocation}: CORS_ORIGIN and GPU_SERVER_ORIGIN_FOR_CALLBACK are not set in production. CORS will be disabled or highly restrictive unless specific routes override it.`);
  }
}

app.use(cors({
  origin: corsOriginConfig,
  credentials: true, // Allow credentials (cookies) to be sent
}));


// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions

/* Routes */
// Root Route
app.get('/', (req: Request, res: Response) => { // Use _req if req is unused
  logger.info(`${serviceLocation}: Root route accessed`);
  res.json({ message: 'Welcome to the VisHeart API!' });
});

// Mount authentication routes under '/auth'
app.use('/auth', authenticationRoute);

// Mount upload routes under root path
app.use('/', uploadRoute);

// Mount GPU webhook routes under root path
app.use('/', webhookRoute);

// Debug Route
if (envType === 'development') {
  app.use(debugRoute); // Mount debug routes only in development mode
  logger.info(`${serviceLocation}: Debug routes mounted for development environment`);
}

// Status Routes (mount under '/status')
app.use('/status', gpuStatusRoute); // Mount GPU status routes

// Export the configured app instance
export { app };