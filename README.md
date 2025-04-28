# Project README

## Overview

VisHeart is a backend server built with Node.js and Express.js, utilizing TypeScript. It provides the foundational infrastructure for a cardiac segmentation application designed to work with NIFTI and DICOM medical imaging formats. The server currently focuses on user management, authentication, secure file metadata storage, and robust logging, setting the stage for future integration of segmentation processing capabilities.

## Description

This project is a Node.js backend application built with TypeScript. It serves as an API for managing user accounts (registration, login with password hashing, guest access), handling file uploads (specifically NIfTI medical image files, `.nii` or `.nii.gz`), extracting metadata from these files using an integrated Python script, and interacting with a MongoDB database via Mongoose to store user and project information. It uses Express.js for routing and middleware. File storage can be configured for local disk or AWS S3.

## Authentication API

Provides endpoints for user registration, session management, and role-based access control.

**Base URL**: `/api/auth`

**Authentication**: Session-based using `express-session` and Passport.js (`passport-local`). A session cookie is issued upon successful login.

---

### `POST /register`

Registers a new standard user account.

**Auth Required**: No

**Request Body**:

```json
{
  "username": "string",
  "password": "string",
  "email": "string",
  "phone": "string"
}
```

**Validation**:

- `username`: 3-20 chars, alphanumeric + underscore. Must be unique.
- `password`: 8+ chars, requires uppercase, lowercase, number, special character.
- `email`: Valid email format. Must be unique.
- `phone`: 10-15 digits.

**Success Response (201 Created)**:

```json
{
  "register": true,
  "message": "Registration successful.",
  "user": {
    "_id": "string",
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "user"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Validation failed (e.g., `{"register": false, "errors": [...]}`).
- `400 Bad Request`: Username or email already exists (e.g., `{"register": false, "message": "Username already exists."}`).

---

### `POST /login`

Authenticates a user and establishes a session.

**Auth Required**: No

**Request Body**:

```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response (200 OK)**:

```json
{
  "login": true,
  "username": "string",
  "role": "user" | "admin",
  "message": "Login successful."
}
```

**Error Responses**:

- `400 Bad Request`: Missing fields (e.g., `{"login": false, "errors": [...]}`).
- `401 Unauthorized`: Invalid credentials (e.g., `{"login": false, "message": "Incorrect username or password."}`).
- `500 Internal Server Error`: Server-side issue during authentication.

---

### `POST /guest`

Creates a temporary guest account and establishes a session.

**Auth Required**: No

**Success Response (200 OK)**:

```json
{
  "login": true,
  "guest": true,
  "username": "guest_<uuid>",
  "role": "guest",
  "message": "Logged in as guest."
}
```

**Error Responses**:

- `500 Internal Server Error`: Failed to create guest user (e.g., `{"login": false, "message": "Failed to create guest account."}`).

**Notes**:

- Guest accounts are automatically deleted upon logout.

---

### `POST /logout`

Terminates the current user session.

**Auth Required**: Yes

**Success Response (200 OK)**:

```json
{
  "message": "Logout successful."
}
```

**Error Responses**:

- `401 Unauthorized`: No active session.
- `500 Internal Server Error`: Server-side issue during logout.

**Notes**:

- If the logged-out user is a guest, their account and associated data are deleted.

---

### `POST /update`

Updates an authenticated user's profile information.

**Auth Required**: Yes (Role: User or Admin, not Guest)

**Request Body**:

```json
{
  "username": "string",
  "password": "string",
  "email": "string",
  "phone": "string"
}
```

**Validation**:

- `username`: 3-20 chars, alphanumeric + underscore. Must be unique.
- `email`: Valid email format. Must be unique.
- `phone`: 10-15 digits.

**Success Response (200 OK)**:

```json
{
  "update": true,
  "message": "User information updated successfully.",
  "user": {
    "_id": "string",
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "user"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Validation failed (e.g., `{"update": false, "errors": [...]}`).
- `400 Bad Request`: Username or email already exists (e.g., `{"update": false, "message": "Username already exists."}`).
- `401 Unauthorized`: No active session.
- `403 Forbidden`: User is authenticated but has Guest role.
- `500 Internal Server Error`: Server-side issue during update.

**Notes**:

- Password updates are handled through a separate endpoint.
- Only the user's own profile can be updated with this endpoint.

---

### `GET /protected`

Test endpoint to verify user authentication.

**Auth Required**: Yes

**Success Response (200 OK)**:

```json
{
  "message": "You are authenticated!"
}
```

**Error Responses**:

- `401 Unauthorized`: No active session.

---

### `GET /admin`

Test endpoint to verify admin privileges.

**Auth Required**: Yes (Role: Admin)

**Success Response (200 OK)**:

```json
{
  "message": "You are an admin!"
}
```

**Error Responses**:

- `401 Unauthorized`: No active session.
- `403 Forbidden`: User is authenticated but does not have the 'Admin' role.

---

## User Roles and Access Control

The API supports three user roles:

1. **Admin**: Full system access including admin-only endpoints
2. **User**: Standard authenticated access to protected resources
3. **Guest**: Limited access with temporary account

## Error Handling

All endpoints follow consistent error formats:

- **Validation errors**: Return 400 with array of validation details
- **Authentication failures**: Return 401 with error message
- **Permission issues**: Return 403 with error message
- **Server errors**: Return 500 with error message

## Security Notes

1. Passwords are securely hashed before storage
2. Session management includes proper timeout handling
3. Input validation is performed on all endpoints

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

## License

This project is licensed under the MIT License - see the LICENSE file for details.
