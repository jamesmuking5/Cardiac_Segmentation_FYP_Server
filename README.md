# VisHeart Backend Server

Stack: 

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)

Written in:

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)

## Overview

VisHeart is a Node.js backend server built with TypeScript and Express.js. It provides APIs for user management, authentication, medical image file (NIFTI, DICOM) handling, metadata extraction via Python, and data persistence using MongoDB with Mongoose. It supports local or AWS S3 file storage and is designed to integrate with a GPU-accelerated inference server.

The GPU server component can be found at [VisHeart GPU Inference Repository](https://github.com/jamesmuking5/visheart-inference-gpu).

## Authentication API

Provides endpoints for user registration, session management, and role-based access control.

**Base URL**: `/api/auth` (or as configured)

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

- `400 Bad Request`: Validation failed (e.g., `{"register": false, "errors": [{"field": "username", "message": "Username must be unique"}]}`).
- `400 Bad Request`: Username or email already exists (e.g., `{"register": false, "message": "Username already exists."}`).
- `500 Internal Server Error`: Server-side issue.

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

- `400 Bad Request`: Missing fields.
- `401 Unauthorized`: Invalid credentials (e.g., `{"login": false, "message": "Incorrect username or password."}`).
- `500 Internal Server Error`: Server-side issue.

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
- `500 Internal Server Error`: Server-side issue.

**Notes**:

- If the logged-out user is a guest, their account and associated data (projects, files) are deleted.

---

### `POST /update`

Updates an authenticated user's profile information (username, email, phone).

**Auth Required**: Yes (Role: `user` or `admin`)

**Request Body**:

```json
{
  "username": "string (optional)",
  "email": "string (optional)",
  "phone": "string (optional)"
}
```

_At least one field must be provided._

**Validation**:

- `username`: 3-20 chars, alphanumeric + underscore. Must be unique if provided.
- `email`: Valid email format. Must be unique if provided.
- `phone`: 10-15 digits if provided.

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
    "role": "user" | "admin"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Validation failed (e.g., `{"update": false, "errors": [...]}`).
- `400 Bad Request`: Username or email already exists (e.g., `{"update": false, "message": "Email already exists."}`).
- `400 Bad Request`: No fields to update provided (e.g., `{"update": false, "message": "No fields to update were provided."}`).
- `401 Unauthorized`: No active session.
- `403 Forbidden`: Authenticated user has `guest` role.
- `500 Internal Server Error`: Server-side issue.

**Notes**:

- Only the user's own profile can be updated with this endpoint.

---

### `POST /update-password`

Updates an authenticated user's password.

**Auth Required**: Yes (Role: `user` or `admin`)

**Request Body**:

```json
{
  "old_password": "string",
  "password": "string"
}
```

**Validation**:

- `old_password`: Must match the user's current password.
- `password` (new password): 8+ chars, requires uppercase, lowercase, number, special character.

**Success Response (200 OK)**:

```json
{
  "update": true,
  "message": "User password updated successfully.",
  "user": {
    "_id": "string",
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "user" | "admin"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Validation failed for the new password.
- `400 Bad Request`: New password is the same as the old password.
- `401 Unauthorized`: No active session.
- `401 Unauthorized`: Old password incorrect.
- `403 Forbidden`: Authenticated user has `guest` role.
- `500 Internal Server Error`: Server-side issue.

---

### `POST /update-role`

Updates a specified user's role.

**Auth Required**: Yes (Role: `admin`)

**Request Body**:

```json
{
  "username": "string",
  "newrole": "user" | "admin" | "guest"
}
```

**Validation**:

- `username`: Must correspond to an existing user.
- `newrole`: Must be a valid `UserRole`.

**Success Response (200 OK)**:

```json
{
  "update": true,
  "message": "User <username> role updated to <newrole>.",
  "user": {
    "_id": "string",
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "user" | "admin" | "guest"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Missing `username` or `newrole`.
- `400 Bad Request`: Invalid `newrole` value (schema validation).
- `400 Bad Request`: Attempting to change the role of the last administrator.
- `401 Unauthorized`: No active session.
- `403 Forbidden`: Authenticated user is not an `admin`.
- `404 Not Found`: User specified by `username` not found.
- `500 Internal Server Error`: Server-side issue.

---

### `GET /fetch`

Fetches the profile information for the currently authenticated user.

**Auth Required**: Yes

**Success Response (200 OK)**:

```json
{
  "fetch": true,
  "message": "User information fetched successfully.",
  "user": {
    "_id": "string",
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "user" | "admin" | "guest"
  }
}
```

**Error Responses**:

- `401 Unauthorized`: No active session.
- `404 Not Found`: Authenticated user not found in database (should be rare).
- `500 Internal Server Error`: Server-side issue.

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

**Auth Required**: Yes (Role: `admin`)

**Success Response (200 OK)**:

```json
{
  "message": "You are an admin!"
}
```

**Error Responses**:

- `401 Unauthorized`: No active session.
- `403 Forbidden`: User is authenticated but not an `admin`.

---

## User Roles and Access Control

- **Admin**: Full system access, including user management.
- **User**: Standard authenticated access to protected resources and their own data.
- **Guest**: Limited, temporary access. Data associated with guest accounts is typically ephemeral.

## Error Handling

- **400 Bad Request**: Client-side errors (e.g., validation, missing parameters). Response often includes an `errors` array or specific `message`.
- **401 Unauthorized**: Authentication required or failed (e.g., invalid credentials, no session).
- **403 Forbidden**: Authenticated user lacks necessary permissions for the resource.
- **404 Not Found**: Requested resource does not exist.
- **500 Internal Server Error**: Unexpected server-side error.

## Security Notes

- Passwords are hashed using bcrypt.
- Sessions are managed securely with `httpOnly` cookies.
- Input validation is applied to prevent common vulnerabilities.
- Role-based access control restricts endpoint access.

## Usage

### Prerequisites

- Node.js (version specified in `.nvmrc` or latest LTS)
- npm or yarn
- MongoDB instance (local or remote)
- Python (for metadata extraction script)

### Setup

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Create a .env file from .env.template and configure variables (e.g., `MONGODB_URI`, `SESSION_SECRET`, `PORT`).

### Development

- Start the server with TypeScript compilation and hot-reloading:
  ```bash
  npm run dev
  ```

### Production

1.  **Build:** Compile TypeScript to JavaScript:
    ```bash
    npm run build
    ```
2.  **Start:** Run the compiled application:
    ```bash
    npm start
    ```
    Ensure production environment variables are set in .env.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
