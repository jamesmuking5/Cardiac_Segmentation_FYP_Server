// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose, { Schema, model, Model } from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import * as bcrypt from "bcrypt";

// Import utility functions
import LogError from "../utils/error_logger"; // Import the error logging utility
const serviceLocation = "Database"; // Service location for error logging

// Import Types
import { IUser, IUserDocument, IUserSafe, UserRole, IProject, CRUDOperation } from "../types/database_types"; // Import the user types

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });
} catch (error: unknown) {
  LogError(error as Error, serviceLocation, "Error loading .env file.");
};

// Database connection URL and name
const DB_NAME = "visheart";
const DB_URI: string = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

// Fetch default admin password
const adminPass: string = process.env.ADMIN_PASS || "admin"; // Default to "admin" if not set

// Connect to MongoDB (called in index.ts)
// Added parameter so can be used in test files to connect to a different database if needed, but default is the environment variable
/**
 * Connects to the MongoDB database using the Mongoose library and the connection URI
 * @async
 * @function connectToDatabase
 * @returns {Promise<void>} A promise that resolves when the database connection is established
 * and the admin user check is complete.
 * @throws {Error} Throws an error if the connection to the MongoDB database fails,
 * wrapping the original Mongoose connection error.
 */
const connectToDatabase = async (): Promise<void> => {
  try {
    // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    // Added this for unit test to use the createAdminUser function without explicitly exposing it
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(DB_URI);
      logger.info(`Database: Connected to MongoDB database: ${DB_NAME} at ${DB_URI}`);
    } else {
      logger.info(`Database: Already connected to ${DB_NAME}. Skipping connect call.`);
    }
    await createAdminUser();
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error connecting to MongoDB database: ${DB_NAME} at ${DB_URI}`)
    throw new Error(`Error connecting to MongoDB: ${error}`);
  }
};

/**
 * Converts a Mongoose user document (`IUserDocument`) into a safe user object (`IUserSafe`)
 * by selecting specific fields and converting the `_id` to a string.
 * This is used to prepare user data for responses, removing sensitive information like the password.
 *
 * @function toIUserSafe
 * @param {IUserDocument} user - The Mongoose user document to convert.
 * @returns {IUserSafe} A new object containing only the safe-to-expose user properties.
 */
function toIUserSafe(user: IUserDocument): IUserSafe {
  return {
    _id: String(user._id),
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

/* Collection Creation */
// User Collection
const userSchema = new Schema<IUserDocument>({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, enum: Object.values(UserRole), default: UserRole.User },
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Create the model with proper typing
const userModel = model<IUserDocument, Model<IUserDocument>>("User", userSchema);

/**
 * Checks if an administrator user exists in the database. If not, creates a default
 * administrator account with predefined credentials ("admin" username, password from
 * `ADMIN_PASS` environment variable or "admin" default, default email/phone).
 * This function is typically called internally during database initialization (`connectToDatabase`).
 * It logs information about whether an admin exists or if a default one is created.
 * A warning is logged upon successful creation of the default admin, advising password change.
 *
 * @async
 * @function createAdminUser
 * @returns {Promise<void>} A promise that resolves once the check and potential creation are complete.
 * @throws {Error} Logs an error via `LogError` if any database operation fails during the process.
 */
const createAdminUser = async (): Promise<void> => {
  // Check if an admin user exists
  // Cannot use IUserDocument ONLY here because it may return null if no admins exist.
  // If it returns a user, TypeScript auto casts it to IUserDocument because of const User = model<IUserDocument, Model<IUserDocument>>("User", userSchema);.
  // The default is IUserDocument | null but can just let auto infer the type.
  const existingAdmin = await userModel.findOne({ role: UserRole.Admin });
  try {
    if (!existingAdmin) {
      logger.info(
        `Database: No admin account found. Creating default admin account.`
      );
      // Create an admin user with username "admin" and password "admin" (Emergency creation of admin account in case of no admin account)
      const hashedPassword = await bcrypt.hash(adminPass, 10);
      // Here, can use IUserDocument because it is guaranteed to be a user and not null.
      const admin: IUserDocument = new userModel({
        username: "admin",
        password: hashedPassword,
        email: "admin@example.com",
        phone: "1234567890",
        role: UserRole.Admin,
      });
      // Save the admin user to the database
      await admin.save();
      // Check if the admin user was created successfully
      const createdAdmin = await userModel.findOne({ username: "admin" });
      if (createdAdmin) logger.warn(`Database: WARNING: Default admin account created successfully with ID:${createdAdmin._id}. Please change the password IMMEDIATELY.`);
    } else {
      logger.info(`Database: Admin account(s) already exists.`);
      return;
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error checking or creating admin account.");
  }
};


// User Functions
// Define result type for user CRUD operations
/**
 * Defines the standard structure for the result object returned by user-related database operations
 * (create, read, update, delete, authenticate).
 * @interface UserCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IUserSafe} [user] - The resulting user object (sanitized), typically included on successful CREATE, UPDATE, or AUTHENTICATE operations.
 * @property {IUserSafe[]} [users] - An array of user objects (sanitized), typically included on successful READ operations. Can be empty if no users match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, user not found) or warnings.
 */
interface UserCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  user?: IUserSafe; // The created or updated user document (applicable for CREATE and UPDATE operations)
  users?: IUserSafe[]; // Array of user documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

/**
 * Creates a new user record in the database with the provided details.
 * Hashes the password using bcrypt before storing it.
 * Checks for uniqueness constraints on username, email, and phone number.
 *
 * @async
 * @function createUser
 * @param {string} username - The desired username for the new user (must be unique).
 * @param {string} password - The plain-text password for the new user.
 * @param {string} email - The email address for the new user (must be unique).
 * @param {string} phone - The phone number for the new user (must be unique).
 * @param {UserRole} [role=UserRole.User] - The role to assign to the user. Defaults to `UserRole.User`.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.CREATE, user: IUserSafe }` containing the sanitized created user.
 * - On validation failure (duplicate username/email/phone): `{ success: false, operation: CRUDOperation.CREATE, message: string }` detailing the conflict.
 * - On other errors: `{ success: false, operation: CRUDOperation.CREATE, message: "Error creating user." }`.
 */
const createUser = async (
  username: string,
  password: string,
  email: string,
  phone: string,
  role: UserRole = UserRole.User, // Default role is "user" unless specified otherwise
): Promise<UserCrudResult> => {
  try {
    // Use a single query with $or to check all unique constraints
    const existingUser = await userModel.findOne({
      $or: [{ username: username }, { email: email }, { phone: phone }],
    });
    if (existingUser) {
      let reasons = `User already exists:`;
      if (existingUser.username === username) {
        reasons += ` Username "${username}" already exists.`;
      }
      if (existingUser.email === email) {
        reasons += ` Email "${email}" already exists.`;
      }
      if (existingUser.phone === phone) {
        reasons += ` Phone "${phone}" already exists.`;
      }
      logger.warn(`Database: Error creating user: ${reasons}`);
      return { success: false, operation: CRUDOperation.CREATE, message: reasons };
    }
    // Hash the password before saving it to the database
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create a new user instance
    const newUser: IUserDocument = new userModel({
      username: username,
      password: hashedPassword,
      email: email,
      phone: phone,
      role: role,
    });
    // Save the new user to the database
    await newUser.save();
    logger.info(`Database: User ${newUser._id} created successfully: ${newUser.username}, ${newUser.email}, ${newUser.phone}, ${newUser.role}`);
    return { success: true, operation: CRUDOperation.CREATE, user: toIUserSafe(newUser) };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating user ${username}.`);
    return { success: false, operation: CRUDOperation.CREATE, message: "Error creating user." };
  }
};

// Todo - user identifier

/**
 * Reads user records from the database based on optional search criteria.
 * If multiple criteria (username, email, phone, role) are provided, users matching *any* of the criteria (`$or` logic) are returned.
 * If no criteria are provided, all users in the database are returned.
 *
 * @async
 * @function readUser
 * @param {string} [username] - Optional. The username to search for.
 * @param {string} [email] - Optional. The email address to search for.
 * @param {string} [phone] - Optional. The phone number to search for.
 * @param {UserRole} [role] - Optional. The user role to filter by.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success (users found): `{ success: true, operation: CRUDOperation.READ, users: IUserSafe[] }` containing an array of matching sanitized users.
 * - On success (no users found): `{ success: true, operation: CRUDOperation.READ, users: [], message: "No users found..." }`. Finding no users is considered a successful operation.
 * - On error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading user." }`.
 * @example
 * // Find a specific user by username
 * await readUser("johndoe");
 * // Find all admin users
 * await readUser(undefined, undefined, undefined, UserRole.Admin);
 * // Find users by email OR phone
 * await readUser(undefined, "john@example.com", "1234567890");
 * // Read all users
 * await readUser();
 */
const readUser = async (
  username?: string,
  email?: string,
  phone?: string,
  role?: UserRole,
): Promise<UserCrudResult> => {

  const searchConditions: object[] = [];
  if (username) searchConditions.push({ username: username });
  if (email) searchConditions.push({ email: email });
  if (phone) searchConditions.push({ phone: phone });
  if (role) searchConditions.push({ role: role });

  // String representation for logging purposes
  const filterCriteriaString = searchConditions.length > 0
    ? searchConditions.map(cond => JSON.stringify(cond)).join(' OR ')
    : 'all users';
  try {
    let foundUsers: IUserDocument[];
    // If no search conditions are provided, find all users
    if (searchConditions.length === 0) {
      logger.info(`Database: Reading all users.`);
      foundUsers = await userModel.find({});
    } else {
      // If search conditions ARE provided, use $or logic
      const query = { $or: searchConditions };
      logger.info(`Database: Reading users matching ANY of: ${filterCriteriaString}`);
      foundUsers = await userModel.find(query);
    }
    // Process the results
    if (foundUsers.length === 0) {
      logger.info(`Database: No users found matching criteria: ${filterCriteriaString}`);
      // Return SUCCESS, but with empty array - It's not an error to find nothing
      return {
        success: true, // Operation succeeded
        operation: CRUDOperation.READ,
        users: [], // Found zero users
        message: "No users found matching the specified criteria.",
      };
    }

    // Convert found users to IUserSafe for public use
    const safeUsers: IUserSafe[] = foundUsers.map(toIUserSafe); // Simplified map usage
    logger.info(`Database: Successfully read ${safeUsers.length} user(s) matching criteria: ${filterCriteriaString}`);
    return {
      success: true,
      operation: CRUDOperation.READ,
      users: safeUsers,
    };

  }
  catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading user ${username}.`);
    return { success: false, operation: CRUDOperation.READ, message: "Error reading user." };
  }
}

/**
 * Updates an existing user's record in the database.
 * The user to update is identified by their current `username`.
 * The `updates` object specifies which fields to change. At least one valid field must be provided for an update to occur.
 * If `password` is provided, it will be hashed before saving.
 * Checks for uniqueness conflicts if `username`, `email`, or `phone` are being changed, ensuring the new value isn't already used by *another* user.
 *
 * @async
 * @function updateUser
 * @param {string} username - The current username of the user to update. This is used for the initial lookup.
 * @param {object} updates - An object containing the fields to update. All properties are optional.
 * @param {string} [updates.username] - The new username.
 * @param {string} [updates.password] - The new plain-text password.
 * @param {string} [updates.email] - The new email address.
 * @param {string} [updates.phone] - The new phone number.
 * @param {UserRole} [updates.role] - The new role for the user.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.UPDATE, user: IUserSafe }` containing the sanitized, updated user.
 * - On failure (user not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "User ... does not exist." }`.
 * - On failure (no changes provided): `{ success: false, operation: CRUDOperation.UPDATE, message: "No fields to update..." }`.
 * - On failure (uniqueness conflict): `{ success: false, operation: CRUDOperation.UPDATE, message: "Username/Email/Phone ... already in use..." }`.
 * - On other errors: `{ success: false, operation: CRUDOperation.UPDATE, message: "Error updating user." }`.
 */
const updateUser = async (
  // Identifying parameter
  username: string,
  // Updates object
  updates: {
    username?: string;
    password?: string;
    email?: string;
    phone?: string;
    role?: UserRole;
  }
): Promise<UserCrudResult> => {
  try {
    // Check if the user exists
    const existingUser = await userModel.findOne({ username: username });
    if (!existingUser) {
      logger.warn(`Database: User ${username} does not exist.`);
      return { success: false, operation: CRUDOperation.UPDATE, message: `User ${username} does not exist.` };
    }
    // NOTE - use user._id from now on instead of username because username be one of the fields being updated.
    // Create update object and track what fields are being updated
    const updateData: Partial<IUser> = {};
    const unchangedFields: string[] = [];

    // Check password (hash first)
    if (updates.password !== undefined) {
      const samePassword = await bcrypt.compare(
        updates.password,
        existingUser.password
      );
      if (samePassword) {
        unchangedFields.push("password");
      } else {
        updateData.password = await bcrypt.hash(updates.password, 10);
      }
    }

    // Check username
    if (updates.username !== undefined) {
      if (updates.username === existingUser.username) {
        unchangedFields.push("username");
      } else {
        // Check if the username is already in use by another user
        const usernameExists = await userModel.findOne({
          username: updates.username,
          _id: { $ne: existingUser._id }, // Exclude current user
        });
        if (usernameExists) return { success: false, operation: CRUDOperation.UPDATE, message: `Username "${updates.username}" is already in use by another user.`, };
        updateData.username = updates.username;
      }
    }

    // Check email
    if (updates.email !== undefined) {
      if (updates.email === existingUser.email) {
        unchangedFields.push("email");
      } else {
        // Check if the email is already in use by another user
        const emailExists = await userModel.findOne({
          email: updates.email,
          _id: { $ne: existingUser._id }  // Exclude current user
        });

        if (emailExists) {
          return { success: false, operation: CRUDOperation.UPDATE, message: `Email "${updates.email}" is already in use by another user.`, };
        }
        updateData.email = updates.email;
      }
    }

    // Check phone
    if (updates.phone !== undefined) {
      if (updates.phone === existingUser.phone) {
        unchangedFields.push("phone");
      } else {
        // Check if the phone is already in use by another user
        const phoneExists = await userModel.findOne({
          phone: updates.phone,
          _id: { $ne: existingUser._id } // Exclude current user
        });

        if (phoneExists) {
          return { success: false, operation: CRUDOperation.UPDATE, message: `Phone "${updates.phone}" is already in use by another user.`, };
        }
        updateData.phone = updates.phone;
      }
    }

    // Add role update capability
    if (updates.role !== undefined) {
      if (updates.role === existingUser.role) {
        unchangedFields.push("role");
      } else {
        updateData.role = updates.role;
      }
    }

    // Return if no fields were updated at all
    if (Object.keys(updateData).length === 0) {
      logger.warn(`Database: No fields to update for user ${username}. Unchanged fields: ${unchangedFields.join(", ")}`);
      return { success: false, operation: CRUDOperation.UPDATE, message: `No fields to update for user ${username}.`, };
    }

    // Perform the update
    const updatedUser = existingUser.set(updateData);
    await updatedUser.save();
    logger.info(`Database: User ${username} updated successfully. Updated fields: ${Object.keys(updateData).join(", ")}`);
    return { success: true, operation: CRUDOperation.UPDATE, user: toIUserSafe(updatedUser) };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating user ${username}.`);
    return { success: false, operation: CRUDOperation.UPDATE, message: "Error updating user." };
  }
};

// Should return a success message if the user is deleted successfully with UserCrudResult
// Could possibly implement a 'move-to-deleted-users' collection instead of deleting the user, but for now, just delete the user.
// Unit test should just check if the user is deleted with this function, by using readUser to check if the user exists after deletion since they read from  same collection.
// This should also delete any files associated with the user, but that is not implemented yet. (TODO: Implement file deletion)
/**
 * Deletes a user from the database, identified by their username.
 * Includes a safety check to prevent deletion of the last remaining administrator account.
 * TODO: Implement deletion of files associated with the user.
 *
 * @async
 * @function deleteUser
 * @param {string} username - The username of the user to delete.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.DELETE, message: "User ... deleted successfully." }`.
 * - On failure (user not found): `{ success: false, operation: CRUDOperation.DELETE, message: "User ... does not exist." }`.
 * - On failure (attempting to delete last admin): `{ success: false, operation: CRUDOperation.DELETE, message: "Cannot delete the last administrator account" }`.
 * - On failure (deletion confirmation failed or other error): `{ success: false, operation: CRUDOperation.DELETE, message: "Error when deleting user." / "User ... was not deleted successfully." }`.
 */
const deleteUser = async (username: string): Promise<UserCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {

    // Check if the user exists
    const existingUser = await userModel.findOne({ username: username });
    // Check if the user is an admin and if this is the last admin
    if (existingUser && existingUser.role === UserRole.Admin) {
      // Check if this is the last admin
      const adminCount = await userModel.countDocuments({ role: UserRole.Admin });
      if (adminCount <= 1) {
        logger.warn(`Database: Attempted to delete last admin user: ${username}`);
        return { success: false, operation, message: 'Cannot delete the last administrator account' };
      }
    }
    if (!existingUser) {
      logger.warn(`Database: User ${username} does not exist.`);
      return { success: false, operation, message: `User ${username} does not exist.` };
    }
    // Delete the user
    await userModel.deleteOne({ username: username });
    // Check if the user was deleted successfully using readUser function
    const deletedUserResult = await readUser(username);
    if (deletedUserResult.success && deletedUserResult.users && deletedUserResult.users.length > 0) {
      // This condition should ideally not be met if deleteOne succeeded without error,
      // but it's kept as a safeguard based on the original code's logic.
      logger.warn(`Database: User ${username} was not deleted successfully.`);
      return { success: false, operation, message: `User ${username} was not deleted successfully.` };
    }
    // User deleted successfully
    logger.info(`Database: User ${username} deleted successfully.`);
    return { success: true, operation, message: `User ${username} deleted successfully.` };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting user ${username}.`);
    return { success: false, operation, message: "Error when deleting user." };
  }
};

// Auxiliary User functions
/**
 * Authenticates a user by verifying the provided username and password against the database records.
 * Performs basic input validation (non-empty username and password).
 * Compares the provided password attempt against the stored hash using bcrypt.
 * Returns a generic error message for common failure scenarios (user not found, incorrect password)
 * to avoid leaking information.
 *
 * @async
 * @function authenticateUser
 * @param {string} username - The username provided for authentication. Must be a non-empty string.
 * @param {string} passwordAttempt - The plain-text password provided for authentication. Must not be null, undefined, or empty.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On successful authentication: `{ success: true, operation: CRUDOperation.AUTHENTICATE, user: IUserSafe }` containing the sanitized authenticated user.
 * - On authentication failure (invalid input, user not found, password mismatch): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "Invalid username or password." }`.
 * - On failure due to account configuration issue (e.g., missing password hash in DB): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "Authentication failed due to an account configuration issue." }`.
 * - On internal server error (database issue, bcrypt error): `{ success: false, operation: CRUDOperation.AUTHENTICATE, message: "An internal server error occurred..." }`.
 */
const authenticateUser = async (
  username: string,
  passwordAttempt: string
): Promise<UserCrudResult> => {

  const operation = CRUDOperation.AUTHENTICATE;

  // Check for null, undefined, empty strings, or non-string types for username
  if (!username || typeof username !== 'string' || username.trim() === '') {
    logger.warn(`Database: Attempt with invalid or empty username.`);
    return { success: false, operation, message: 'Invalid username or password.' };
  }

  // Check for null, undefined, or empty string for password (allow any characters)
  if (passwordAttempt === undefined || passwordAttempt === null || passwordAttempt === '') { // Explicitly check empty string
    logger.warn(`Database: Attempt for username "${username}" with missing or empty password.`);
    return { success: false, operation, message: 'Invalid username or password.' };
  }

  try {
    // 1. Find the user specifically by username
    // Use .select('+password') to ensure the password hash is retrieved especially if have schema-level settings that might exclude it by default.
    const user: IUserDocument | null = await userModel.findOne({ username: username }).select('+password');

    // 2. Handle case where username doesn't exist
    if (!user) {
      logger.warn(`Database: Login attempt failed for non-existent username: ${username}`);
      return { success: false, operation, message: 'Invalid username or password.' };
    }

    // Check if the user record retrieved actually has a valid password hash stored, protects against data corruption or improperly created user records.
    if (!user.password || typeof user.password !== 'string' || user.password.length === 0) {
      logger.error(`Database: User "${username}" found in DB but has a missing, null, or empty password hash. Cannot authenticate.`);
      return { success: false, operation, message: 'Authentication failed due to an account configuration issue.' };
    }

    // 3. Compare the provided password attempt with the stored hash
    const isMatch = await bcrypt.compare(passwordAttempt, user.password);

    // 4. Handle case where passwords don't match
    if (!isMatch) {
      logger.warn(`Database: Login attempt failed for username: ${username} (Incorrect password)`);
      return { success: false, operation, message: 'Invalid username or password.' };
    }

    // 5. Authentication successful!
    logger.info(`Database: Login successful for username: ${username}`);
    return { success: true, operation, user: toIUserSafe(user) };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error during authentication process for username ${username}.`);
    return { success: false, operation, message: 'An internal server error occurred during authentication.' };
  }
};

// // File Functions
// // Define result type for createFile function
// /**
//  * Defines the structure for the result object returned specifically by the `createFile` function.
//  * @typedef {object} FileCrudResult
//  * @property {boolean} success - Indicates whether the file CRUD result operation was successful
//  * @property {IFileDocument} [file] - The created file document, depending on the CRUD operation performed.
//  * @property {string} [error] - An error message detailing the reason for failure, included only on failure (e.g., duplicate file, database error).
//  */
// interface FileCrudResult {
//   success: boolean; // Indicates whether the operation was successful
//   operation: CRUDOperation; // The type of operation performed (CREATE, READ)
//   file?: IFileSafe; // The created file document (applicable for CREATE operation)
//   files?: IFileSafe[]; // Array of file documents (applicable for READ operation)
//   message?: string; // Message if the operation failed
// }

// /**
//  * Creates a new file metadata record in the database.
//  * Checks if a file with the same `filename` OR the same `filehash` already exists to prevent duplicates.
//  *
//  * @async
//  * @function createFile
//  * @param {string} filename - The original name of the file.
//  * @param {string} filepath - The path where the file is stored (local or remote).
//  * @param {FileType} filetype - The MIME type of the file based on the FileType enum.
//  * @param {string} filehash - A hash of the file's content.
//  * @param {number} filesize - The size of the file in bytes.
//  * @param {IUserSafe._id} createdBy - The identifier (ID) of the user creating the record.
//  * @param {string} [description] - An optional description for the file. Defaults to `undefined`.
//  * @returns {Promise<FileCrudResult>} A promise that resolves to a `FileCrudResult` object.
//  * - On success: `{ success: true, file: IFileDocument }` containing the newly created file document.
//  * - On failure (duplicate filename/hash): `{ success: false, error: string }` detailing the conflict.
//  * - On other errors: `{ success: false, error: "Error creating file." }`.
//  */
// const createFile = async (
//   filename: string,
//   filepath: string,
//   filetype: FileType,
//   filehash: string,
//   filesize: number, // In bytes
//   createdBy: string,
//   description: string | undefined = undefined
// ): Promise<FileCrudResult> => {
//   try {
//     // Check if file exists with name, hash
//     const existingFile = await fileModel.findOne({
//       $or: [{ filename: filename }, { filehash: filehash }],
//     });
//     if (existingFile) {
//       let reasons = `File already exists: `;
//       if (existingFile.filename === filename) {
//         reasons += `Filename "${filename}" already exists. `;
//       }
//       if (existingFile.filehash === filehash) {
//         reasons += `File hash "${filehash}" already exists. `;
//       }
//       logger.warn(`Database: Error creating file: ${reasons}`);
//       return { success: false, operation: CRUDOperation.CREATE, message: reasons };
//     }
//     // Create a new file instance
//     const newFile: IFileDocument = new fileModel({
//       filename: filename,
//       filepath: filepath,
//       filetype: filetype,
//       filehash: filehash,
//       filesize: filesize,
//       createdBy: createdBy,
//       description: description,
//     });
//     // Save the new file to the database
//     await newFile.save();
//     // Fetch the file and get the id to convert into IFileSafe
//     const savedFile = await fileModel.findById(newFile._id);
//     if (!savedFile) {
//       logger.warn(`Database: File ${filename} was not saved successfully.`);
//       return { success: false, operation: CRUDOperation.CREATE, message: "File was not saved successfully." };
//     }
//     // Convert to IFileSafe for public use
//     const safeFile = toIFileSafe(savedFile);
//     logger.info(`Database: File ${filename} created successfully with name: ${safeFile.filename} and id ${safeFile._id}`);
//     return { success: true, operation: CRUDOperation.CREATE, file: safeFile };
//   }
//   catch (error: unknown) {
//     LogError(error as Error, serviceLocation, `Error creating file ${filename}.`);
//     return { success: false, operation: CRUDOperation.CREATE, message: "Error creating file." };
//   }
// };

// /**
//  * Reads file records from the database based on optional search criteria.
//  * If muliple criteria (filename, filepath, filetype, filehash, filesize, createdBy) are provided,
//  * files matching *any* of the criteria (`$or` logic) are returned.
//  * If no criteria are provided, all files in the database are returned.
//  * NOTE: Only admin users can read all files. Normal users should ONLY READ THEIR OWN FILES. MAKE
//  * SURE TO USE THE `createdBy` field to filter files for normal users.
//  * 
//  * @param {string} filename - The original name of the uploaded file.
//  * @param {string} filepath - The path where the file is stored (local or remote).
//  * @param {FileType} filetype - The MIME type of the file.
//  * @param {string} filehash - A hash (e.g., SHA-256) of the file content for integrity checking and deduplication.
//  * @param {number} filesize - Size of the file in bytes (e.g., 1024 for 1KB).
//  * @param {Date} createdAt - The date when the file was created. Can be used to filter files created within a specific time range. 
//  * @param {IUserDocumnent._id} createdBy - The identifier (ID) of the user who created the file record. Can be fetch with readUser(). If normal user, must be in session and only read their own files.
//  * @param {string} description - Optional description for the file. Defaults to `undefined`.
//  * @returns {Promise<FileCrudResult>} A promise that resolves to a `FileCrudResult` object.
//  * - On success: `{ success: true, operation: CRUDOperation.READ, files: IFileDocument[] }` containing an array of matching file documents.
//  * - On success (no files found): `{ success: true, operation: CRUDOperation.READ, files: [], message: "No files found..." }`. Finding no files is considered a successful operation.
//  * - On failure (error): `{ success: false, operation: CRUDOperation.READ, message: "Error reading file." }`.
//  */
// const readFile = async (
//   fileID?: string,
//   filename?: string,
//   filepath?: string,
//   filetype?: string,
//   filehash?: string,
//   filesize?: number,
//   createdAt?: Date,
//   createdBy?: IUserSafe["_id"], // If normal user, must be in session
//   description?: string | undefined, // Should be if includes when search via Mongo
// ): Promise<FileCrudResult> => {
//   try {

//     const searchConditions: object[] = [];
//     if (fileID) searchConditions.push({ _id: fileID });
//     if (filename) searchConditions.push({ filename: filename });
//     if (filepath) searchConditions.push({ filepath: filepath });
//     if (filetype) searchConditions.push({ filetype: filetype });
//     if (filehash) searchConditions.push({ filehash: filehash });
//     if (filesize) searchConditions.push({ filesize: filesize });
//     if (createdBy) searchConditions.push({ createdBy: createdBy });
//     if (description) searchConditions.push({ description: description });

//     // String representation for logging purposes
//     const filterCriteriaString = searchConditions.length > 0 ? searchConditions.map(cond => JSON.stringify(cond)).join(' OR ') : 'all files';
//     try {
//       let foundFiles: IFileDocument[];
//       // If no search conditions are provided, find all files
//       if (searchConditions.length === 0) {
//         logger.info(`Database: Reading all files.`);
//         foundFiles = await fileModel.find({});
//       } else {
//         // If search conditions ARE provided, use $or logic
//         const query = { $or: searchConditions };
//         logger.info(`Database: Reading files matching ANY of: ${filterCriteriaString}`);
//         foundFiles = await fileModel.find(query);
//       }
//       if (foundFiles.length === 0) {
//         logger.info(`Database: No files found matching criteria: ${filterCriteriaString}`);
//         return { success: true, operation: CRUDOperation.READ, files: [], message: "No files found matching the specified criteria." };
//       }
//       // Return results (no need sanitize)
//       logger.info(`Database: Successfully read ${foundFiles.length} file(s) matching criteria: ${filterCriteriaString}`);
//       // Convert found files to IFileSafe for stringified id
//       const safeFiles: IFileSafe[] = foundFiles.map(toIFileSafe); // Simplified map usage
//       return { success: true, operation: CRUDOperation.READ, files: safeFiles, };
//     } catch (error: unknown) {
//       LogError(error as Error, serviceLocation, `Error reading file ${filename}.`);
//       return { success: false, operation: CRUDOperation.READ, message: "Error reading file." }; // to work on
//     }
//   }
//   catch (error: unknown) {
//     LogError(error as Error, serviceLocation, `Error while reading file(s).`);
//     return { success: false, operation: CRUDOperation.READ, message: "Error looking for the file." };
//   }
// }

// // /**
// //  * File identifier object that requires at least one identification property.
// //  * Used to uniquely identify a file for update operations.
// //  */
// // type FileIdentifier =
// //   | { fileId: string }
// //   | { filename: string }
// //   | { filehash: string }
// //   | { filename: string; filetype: FileType }
// //   | { createdBy: string; filename: string };


// // Update file function - should be similar to updateUser, but for files. 
// // Should be able to identify the one file by filename, id or hash, and then update the fields in the fileModel.
// // Should be able to update any field in the fileModel, but not the _id field.
// const updateFile = async (
//   // Identifying parameters
//   fileId?: string, // no need to convert to MongoDocument ID
//   filename?: string,
//   filetype?: FileType, // Keeping this here in case same file is uploaded in different formats.
//   filehash?: string,
//   // Updates object
//   updates?: {
//     filename?: string;
//     filepath?: string;
//     filetype?: string;
//     filehash?: string;
//     filesize?: number;
//     createdBy?: IUserSafe["_id"];
//     description?: string;
//   }
// ): Promise<FileCrudResult> => {
//   try {
//     // Check if update object exists
//     if (!updates) {
//       logger.warn(`Database: No updates provided for file update.`);
//       return { success: false, operation: CRUDOperation.UPDATE, message: "No updates provided." };
//     }

//     // Check if the file exists using search conditions
//     const searchConditions: object[] = [];
//     if (fileId) searchConditions.push({ _id: fileId });
//     if (filename) searchConditions.push({ filename: filename });
//     if (filetype) searchConditions.push({ filetype: filetype });
//     if (filehash) searchConditions.push({ filehash: filehash });

//     if (searchConditions.length === 0) {
//       logger.warn(`Database: No search conditions provided for file update.`);
//       return { success: false, operation: CRUDOperation.UPDATE, message: "No search conditions provided." };
//     }
//     const existingFile = await fileModel.findOne({ $or: searchConditions });
//     if (!existingFile) {
//       logger.warn(`Database: File not found with provided criteria.`);
//       return { success: false, operation: CRUDOperation.UPDATE, message: "File not found." };
//     }
//     // Create update object and track what fields are being updated
//     const updateData: Partial<IFileDocument> = {};
//     const unchangedFields: string[] = [];

//     // For simple file fields that don't need special handling
//     const simpleFields: (keyof typeof updates)[] = [
//       'filename', 'filepath', 'filetype', 'filehash',
//       'filesize', 'createdBy', 'description'
//     ];

//     // Process each field in a loop
//     for (const field of simpleFields) {
//       if (updates[field] !== undefined) {
//         if (updates[field] === existingFile[field]) {
//           unchangedFields.push(field);
//         } else {
//           // Need to cast to any due to TypeScript's limitations with dynamic property access
//           (updateData as any)[field] = updates[field];
//         }
//       }
//     }

//     // Return if no fields were updated at all
//     if (Object.keys(updateData).length === 0) {
//       logger.warn(`Database: No fields to update for file ${filename}. Unchanged fields: ${unchangedFields.join(", ")}`);
//       return { success: false, operation: CRUDOperation.UPDATE, message: `No fields to update for file ${filename}.` };
//     }

//     // Update the file in database
//     const updatedFile = existingFile.set(updateData);
//     await updatedFile.save();
//     logger.info(`Database: File ${filename} updated successfully. Updated fields: ${Object.keys(updateData).join(", ")}`);
//     // Convert to IFileSafe for public use
//     const safeFile = toIFileSafe(updatedFile);
//     return { success: true, operation: CRUDOperation.UPDATE, file: safeFile };
//   } catch (error: unknown) {
//     LogError(error as Error, serviceLocation, `Error updating file ${filename}.`);
//     return { success: false, operation: CRUDOperation.UPDATE, message: "Error updating file." };
//   }
// }

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
// ONLY unit tests should use userModel, fileModel directly, otherwise use the created functions to create users/files.
export { connectToDatabase, userModel, fileModel, createUser, readUser, updateUser, deleteUser, authenticateUser, UserRole, IUserSafe, UserCrudResult, CRUDOperation, FileCrudResult, IFileDocument, IUserDocument };
// createFile, readFile, updateFile,