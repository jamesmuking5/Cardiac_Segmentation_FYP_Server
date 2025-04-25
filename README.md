# Project README

## Description

This project is a Node.js backend application built with TypeScript. It serves as an API for managing user accounts (registration, login with password hashing, guest access), handling file uploads (specifically NIfTI medical image files, `.nii` or `.nii.gz`), extracting metadata from these files using an integrated Python script, and interacting with a MongoDB database via Mongoose to store user and project information. It uses Express.js for routing and middleware. File storage can be configured for local disk or AWS S3.

## Interesting Techniques

This codebase utilizes several modern backend techniques:

* **Modular Routing and Middleware (Express.js)**: The application uses [Express.js](https://developer.mozilla.org/en-US/docs/Learn/Server-side/Express_Nodejs/Introduction) to define API routes (`./src/routes/authentication.ts`, `./src/routes/uploadroutes.ts`). It employs middleware extensively for handling JSON parsing, sessions, authentication (`./src/services/passportjs.ts`), input validation (`./src/middleware/field_validation.ts`), and file uploads (`./src/middleware/uploadmiddleware.ts`).
* **Secure Password Hashing (bcrypt)**: User passwords are securely hashed using [`bcrypt`](https://www.npmjs.com/package/bcrypt) before being stored, significantly increasing security against breaches (`./src/services/database.ts`).
* **Declarative Input Validation (express-validator)**: Uses [`express-validator`](https://express-validator.github.io/docs/) to define clear, chainable rules for validating incoming request data (`./src/middleware/field_validation.ts`, `./src/routes/authentication.ts`), ensuring data integrity before processing.
* **Object Data Modeling & Hooks (Mongoose)**: Leverages [Mongoose](https://mongoosejs.com/) for schema definition (`./src/types/database_types.ts`), data validation, and interaction with MongoDB. It also utilizes Mongoose pre-hooks for lifecycle events, such as cascading deletes where deleting a user automatically removes their associated projects and masks (`./src/services/database.ts`).
* **Asynchronous Operations (async/await)**: Modern JavaScript [`async/await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) syntax is used throughout the codebase (e.g., in `./src/services/database.ts`, `./src/index.ts`) for cleaner handling of asynchronous operations like database queries and file processing.
* **Inter-process Communication (Node.js `child_process`)**: Executes a Python script (`./src/python/extract_metadata.py`) to parse NIfTI file metadata using Node.js's [`child_process`](https://nodejs.org/api/child_process.html) module, specifically `execFile`, demonstrating integration with other languages/processes (`./src/utils/nifti_parser.ts`).
* **Configuration Management (dotenv)**: Manages environment-specific configurations (like database URIs, secrets, ports) using [`dotenv`](https://github.com/motdotla/dotenv), loading variables from a `.env` file into `process.env` (`./src/index.ts`, `./src/services/database.ts`).
* **Logging (Winston)**: Implements structured, level-based logging using [`winston`](https://github.com/winstonjs/winston), including daily log rotation and separate files for different log levels (`./src/services/logger.ts`, `./src/utils/error_logger.ts`).
* **Authentication Strategy (Passport.js)**: Employs [`Passport.js`](https://www.passportjs.org/docs/) with a local strategy (`passport-local`) for username/password authentication and manages user sessions (`./src/services/passportjs.ts`, `./src/services/express_app.ts`).

## Technologies and Libraries

* **Runtime**: Node.js
* **Language**: TypeScript
* **Web Framework**: [Express.js](https://developer.mozilla.org/en-US/docs/Learn/Server-side/Express_Nodejs/Introduction)
* **Database ORM**: [Mongoose](https://mongoosejs.com/) (for MongoDB)
* **Authentication**: [Passport.js](https://www.passportjs.org/docs/) (`passport-local`)
* **Session Management**: `express-session` (Potentially with [Redis](https://redis.io/docs/latest/develop/clients/nodejs/) via `connect-redis`, though Redis store connection is commented out in `./src/services/express_app.ts`)
* **Password Hashing**: [bcrypt](https://www.npmjs.com/package/bcrypt)
* **Input Validation**: [express-validator](https://express-validator.github.io/docs/)
* **File Uploads**: [Multer](https://github.com/expressjs/multer)
* **Cloud Storage**: [AWS SDK for JavaScript (v2)](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/aws-jsdk-reference.html) (for S3 interaction)
* **Logging**: [Winston](https://github.com/winstonjs/winston) (`winston-daily-rotate-file`)
* **Environment Variables**: [dotenv](https://github.com/motdotla/dotenv)
* **NIfTI File Handling**: [Nibabel](https://nipy.org/nibabel/) (Python library accessed via `child_process`)
* **UUID Generation**: `uuid` (for guest IDs in `./src/routes/authentication.ts`)

*(Note: No specific custom fonts are referenced in the backend codebase.)*

## API Routes

The application exposes the following API endpoints (assuming routes are mounted at `/auth` and `/` respectively as configured in `./src/services/express_app.ts` and `./src/routes/uploadroutes.ts`):

* **Authentication (`./src/routes/authentication.ts`)**:
    * `POST /auth/login`: Authenticates a user based on username and password provided in the request body. Uses input validation.
    * `POST /auth/register`: Creates a new user account. Requires username, password, email, and phone in the request body. Uses input validation.
    * `POST /auth/guest`: Logs in a user as a temporary guest, creating a guest account automatically.
    * `POST /auth/logout`: Logs out the currently authenticated user. Requires an active session/authentication.
    * `GET /auth/protected`: An example route demonstrating endpoint protection. Requires authentication.
    * `GET /auth/admin`: An example route demonstrating admin-level protection. Requires authentication and the user to have an 'Admin' role.
* **File Upload (`./src/routes/uploadroutes.ts`)**:
    * `POST /upload`: Handles file uploads. Expects `multipart/form-data` containing the file(s) and a `userId` field in the request body. Uses Multer middleware for processing.
    * `GET /upload`: Returns a message indicating that this endpoint only accepts POST requests for file uploads.

## Project Structure

```
.
├── logs/
│   └── winston_logger/
├── src/
│   ├── controllers/
│   ├── middleware/
│   ├── python/
│   ├── routes/
│   ├── services/
│   ├── tests/
│   ├── types/
│   └── utils/
├── uploads/
└── index.ts
```

* `logs/winston_logger/`: Stores application logs generated by Winston. Rotated daily.
* `src/controllers/`: Contains Express route handlers that orchestrate requests, typically calling service functions (e.g., `./src/controllers/uploadcontroller.ts`).
* `src/middleware/`: Houses Express middleware for tasks like input validation (`./src/middleware/field_validation.ts`) and file upload handling (`./src/middleware/uploadmiddleware.ts`).
* `src/python/`: Contains Python scripts intended to be called from the Node.js application (e.g., `./src/python/extract_metadata.py`).
* `src/routes/`: Defines the API endpoints (URLs) and maps them to specific controllers or middleware chains (e.g., `./src/routes/authentication.ts`, `./src/routes/uploadroutes.ts`).
* `src/services/`: Holds the core application logic, including database interactions (`./src/services/database.ts`), authentication logic (`./src/services/passportjs.ts`), logging setup (`./src/services/logger.ts`), Redis connection (`./src/services/redis.ts`), and file processing logic (`./src/services/upload.ts`). Also includes the Express app configuration (`./src/services/express_app.ts`).
* `src/tests/`: Contains test scripts, including manual database tests (`./src/tests/_db_test.ts`) and utility tests (`./src/tests/test_nifti_extract.ts`).
* `src/types/`: Defines shared TypeScript interfaces and enums, particularly for database schemas (`./src/types/database_types.ts`).
* `src/utils/`: Contains utility functions used across the application, such as error logging (`./src/utils/error_logger.ts`), NIfTI metadata parsing (`./src/utils/nifti_parser.ts`), and file upload helpers (`./src/utils/upload_helper.ts`).
* `uploads/`: The default directory for temporary storage of uploaded files when using Multer's disk storage configuration (`./src/middleware/uploadmiddleware.ts`).
* `index.ts`: The main entry point of the application. It initializes configurations (like environment variables), connects to the database and Redis, and starts the Express server.
