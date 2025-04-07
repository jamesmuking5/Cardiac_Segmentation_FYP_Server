# VisHeart Cardiac Segmentation Server

## Overview

VisHeart is a backend server built with Node.js and Express.js, utilizing TypeScript. It provides the foundational infrastructure for a cardiac segmentation application designed to work with NIFTI and DICOM medical imaging formats. The server currently focuses on user management, authentication, secure file metadata storage, and robust logging, setting the stage for future integration of segmentation processing capabilities.

## Current Features

- **User Management System**
  - User registration with unique username, email, and phone validation.
  - Secure user authentication using Passport.js with the Local Strategy (username/password).
  - Secure password storage using bcrypt hashing.
  - Role-based access control (RBAC) distinguishing between 'user' and 'admin' roles.
  - Middleware to protect routes based on authentication status (`isAuthenticated`) and admin privileges (`isAuthAndAdmin`).
  - Session management handled via `express-session` for persistent logins.
  - Automatic creation of a default 'admin' user on initial startup if no admin exists.
- **Database Integration**
  - MongoDB integration using the Mongoose ODM.
  - Defined Mongoose schemas for User and File metadata.
  - Database connection management with logging.
  - Helper functions (`createUser`, `readUser`, `updateUser`, `authenticateUser`, `createFile`) for interacting with the database models.
  - Sanitized user data (`IUserSafe`) returned from database functions, excluding sensitive information like passwords.
- **API Endpoints**
  - `/auth/register`: Handles new user registration with input validation (`express-validator`).
  - `/auth/login`: Handles user login via Passport LocalStrategy with input validation.
  - `/auth/logout`: Handles user logout and session destruction.
  - `/auth/protected`: Example route accessible only to authenticated users.
  - `/auth/admin`: Example route accessible only to authenticated admin users.
- **Logging System**
  - Advanced logging using `winston`.
  - Daily log file rotation (`winston-daily-rotate-file`) stored in the `logs/winston_logger/` directory.
  - Separate log files for different levels (info, error, warn).
  - Colorized console output for improved readability during development.
  - Dedicated error logging utility (`LogError`) for consistent error reporting.
- **Development & Testing Environment**
  - Developed using TypeScript, configured via `tsconfig.json`.
  - Code linting and formatting enforced by ESLint and Prettier (`eslint.config.mjs`, `package.json`).
  - Unit and integration testing setup with Jest (`jest.config.js`).
  - Tests utilize `mongodb-memory-server` for isolated database testing.
  - Example tests provided for authentication (`__tests__/auth.test.ts`) and database functions (`__tests__/database.test.ts`).
  - Uses `nodemon` for automatic server restarts during development.
  - Build process compiles TypeScript to JavaScript in the `dist/` directory.

## Project Structure

```bash
.
├── tests/                # Test files (Jest)
│   ├── auth.test.ts
│   └── database.test.ts
├── dist/                     # Compiled JavaScript output
├── logs/                     # Application logs
│   └── winston_logger/       # Winston rotating logs
├── node_modules/             # Project dependencies
├── src/                      # Source code (TypeScript)
│   ├── routes/               # API route definitions
│   │   └── authentication.ts
│   ├── services/             # Core service modules
│   │   ├── database.ts       # MongoDB connection, schemas, CRUD functions
│   │   ├── express_app.ts    # Express application setup and middleware
│   │   ├── logger.ts         # Winston logging configuration
│   │   └── passportjs.ts     # Passport.js authentication strategies
│   ├── utils/                # Utility functions
│   │   └── error_logger.ts
│   └── index.ts              # Main application entry point
├── .env                      # Environment variables (Gitignored)
├── .gitignore                # Git ignore configuration
├── eslint.config.mjs         # ESLint configuration
├── jest.config.js            # Jest configuration
├── package-lock.json         # Exact dependency versions
├── package.json              # Project dependencies and scripts
├── README.md                 # This file
└── tsconfig.json             # TypeScript compiler options
```

## Installation

1.  **Clone the repository:**

    ```bash
    git clone [https://github.com/jamesmuking5/Cardiac_Segmentation_FYP_Server.git](https://github.com/jamesmuking5/Cardiac_Segmentation_FYP_Server.git)
    cd Cardiac_Segmentation_FYP_Server
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Create `.env` file:**
    Create a `.env` file in the root directory and add the following environment variables. **Ensure you use strong, unique secrets.**

    ```dotenv
    # Server configuration
    PORT=3000

    # Database configuration
    MONGODB_URI=mongodb://127.0.0.1:27017/visheart # Or your MongoDB connection string

    # Security
    ADMIN_PASS=your_secure_default_admin_password # Password for the auto-created admin
    SESSION_SECRET=your_very_secure_session_secret # Secret key for express-session
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The server should start, connect to the database, create a default admin user if needed, and be accessible at `http://localhost:3000` (or the port specified in `.env`).

## Usage

### Development

- Start the development server with TypeScript compilation and hot-reloading using `nodemon`:
  ```bash
  npm run dev
  ```

### Testing

- Run the Jest test suite (uses in-memory MongoDB):
  ```bash
  npm test
  ```

### Production

1.  **Build the project:** Compile TypeScript to JavaScript in the `dist/` directory:

    ```bash
    npm run build
    ```

2.  **Start the production server:** Run the compiled JavaScript code:
    ```bash
    npm start
    ```
    Ensure your `.env` file is configured correctly for your production environment (especially `MONGODB_URI` and secrets).

## Planned Features

_(This section remains largely unchanged as the code focuses on infrastructure)_

### Short-term Roadmap

1.  **File Upload System**
    - Implement NIFTI and DICOM file upload endpoints using `multer` or similar.
    - Add robust file validation (type, size limits) and integrity checking (hash verification).
    - Implement secure file storage (local or cloud-based).
2.  **Expanded API Endpoints**
    - Develop RESTful API endpoints for file management (upload, download, list, delete, update metadata).
    - Refine user management endpoints (e.g., update profile, password reset).
3.  **Segmentation Processing**
    - Integrate with external cardiac segmentation algorithms/scripts.
    - Implement a job queue system (e.g., BullMQ, Kue) for handling asynchronous segmentation tasks.
    - Design mechanisms for storing and retrieving segmentation results associated with uploaded files.

### Long-term Roadmap

1.  **Advanced Segmentation Features**
    - Support for multiple segmentation algorithms.
    - Tools for comparing segmentation results.
    - Batch processing capabilities for multiple files.
2.  **Analytics Dashboard**
    - Track API usage statistics.
    - Monitor segmentation processing times and resource usage.
    - Log user activity for auditing purposes.
3.  **Enhanced Security**
    - Consider OAuth 2.0 integration for third-party authentication.
    - Implement API key management for programmatic access.
    - Add rate limiting to API endpoints to prevent abuse.
4.  **Scalability Improvements**
    - Containerize the application using Docker.
    - Explore deployment options like Kubernetes.
    - Integrate with cloud storage solutions (e.g., AWS S3, Google Cloud Storage).

## Technical Details

- **Framework:** Node.js with Express.js
- **Language:** TypeScript
- **Database:** MongoDB with Mongoose ODM
- **Authentication:** Passport.js (Local Strategy) with `express-session`
- **Password Hashing:** bcrypt
- **Logging:** Winston with `winston-daily-rotate-file`
- **Testing:** Jest with `ts-jest` and `mongodb-memory-server`
- **Linting/Formatting:** ESLint and Prettier
- **Input Validation:** `express-validator`

### Database Schemas

1.  **User Schema (`userModel`)**
    - Fields: `username` (unique), `password` (hashed), `email` (unique), `phone` (unique), `role` (enum: 'user'/'admin').
    - Ensures uniqueness for critical identifiers.
2.  **File Schema (`fileModel`)**
    - Fields: `filename`, `filepath`, `filetype` (MIME), `filehash` (unique), `filesize` (bytes), `createdAt`, `createdBy` (user reference), `description`.
    - Designed to store metadata about uploaded medical image files.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
