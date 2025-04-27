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
import { IUser, IUserDocument, IUserSafe, UserRole, CRUDOperation, UserCrudResult, IProjectDocument, IProjectSegmentationMaskDocument } from "../types/database_types"; // Import the user types
import { FileType, FileDataType, ComponentBoundingBoxesClass, IProject, IProjectSegmentationMask, ProjectCrudResult, ProjectSegmentationMaskCrudResult } from "../types/database_types"; // Import the project types

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
const adminPass: string = process.env.ADMIN_PASS || "P@ssw0rd123!"; // Default to "P@ssw0rd123!" (follows the validation) if not set

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
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/* User Collection Creation */
// User Collection
const userSchema = new Schema<IUserDocument>({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, enum: Object.values(UserRole), default: UserRole.User },
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// If a user is deleted, delete all their projects and segmentation masks (especially important for guest accounts)
userSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const serviceLocationCascade = `${serviceLocation} - User Delete Hook`;
  try {
    logger.info(`Database: Cascade delete triggered for user ${this._id}`);
    const projects = await projectModel.find({ userid: this._id }).select('_id').lean(); // Use lean for plain objects
    const projectIds = projects.map(p => p._id);
    if (projectIds.length > 0) {
      logger.info(`Database: Deleting ${projectIds.length} projects and their associated masks for user ${this._id}`);
      // Delete all masks for all found projects first
      const maskDeleteResult = await projectSegmentationMaskModel.deleteMany({ projectid: { $in: projectIds } });
      logger.info(`Database: Deleted ${maskDeleteResult.deletedCount} segmentation masks for user ${this._id}`);
      // Then delete all projects for the user
      const projectDeleteResult = await projectModel.deleteMany({ userid: this._id });
      logger.info(`Database: Deleted ${projectDeleteResult.deletedCount} projects for user ${this._id}`);
    } else {
      logger.info(`Database: No projects found for user ${this._id}. No cascade delete needed for projects/masks.`);
    }
    next(); // Proceed to user deletion
  } catch (error: unknown) {
    LogError(error as Error, serviceLocationCascade, `Error during cascade delete for user ${this._id}.`);
    // Halt the original user deletion by passing the error
    next(error instanceof Error ? error : new Error('Failed to cascade delete projects/masks'));
  }
});
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
/**
 * Creates a new user record in the database with the provided details.
 * Hashes the password using bcrypt before storing it.
 * Checks for uniqueness constraints on username, email, and phone number.
 *
 * @async
 * @function createUser
 * @param {IUser} user - The user object containing the details for the new user.
 * @param {string} user.username - The desired username for the new user (must be unique).
 * @param {string} user.password - The plain-text password for the new user.
 * @param {string} user.email - The email address for the new user (must be unique).
 * @param {string} user.phone - The phone number for the new user (must be unique).
 * @param {UserRole} [user.role=UserRole.User] - The role to assign to the user. Defaults to `UserRole.User`.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.CREATE, user: IUserSafe }` containing the sanitized created user.
 * - On validation failure (duplicate username/email/phone): `{ success: false, operation: CRUDOperation.CREATE, message: string }` detailing the conflict.
 * - On other errors: `{ success: false, operation: CRUDOperation.CREATE, message: "Error creating user." }`.
 */
const createUser = async (
  user: IUser,
): Promise<UserCrudResult> => {
  try {
    // Use a single query with $or to check all unique constraints
    const existingUser = await userModel.findOne({
      $or: [{ username: user.username }, { email: user.email }, { phone: user.phone }],
    });
    if (existingUser) {
      let reasons = `User already exists:`;
      if (existingUser.username === user.username) {
        reasons += ` Username "${user.username}" already exists.`;
      }
      if (existingUser.email === user.email) {
        reasons += ` Email "${user.email}" already exists.`;
      }
      if (existingUser.phone === user.phone) {
        reasons += ` Phone "${user.phone}" already exists.`;
      }
      logger.warn(`Database: Error creating user: ${reasons}`);
      return { success: false, operation: CRUDOperation.CREATE, message: reasons };
    }
    // Hash the password before saving it to the database
    const hashedPassword = await bcrypt.hash(user.password, 10);
    // Create a new user instance
    const newUser: IUserDocument = new userModel({
      username: user.username,
      password: hashedPassword,
      email: user.email,
      phone: user.phone,
      role: user.role,
    });
    // Save the new user to the database
    await newUser.save();
    logger.info(`Database: User ${newUser._id} created successfully: ${newUser.username}, ${newUser.email}, ${newUser.phone}, ${newUser.role}`);
    return { success: true, operation: CRUDOperation.CREATE, user: toIUserSafe(newUser) };
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error creating user ${user.username}: ${error}`);
    LogError(error as Error, serviceLocation, `Error creating user ${user.username}.`);
    return { success: false, operation: CRUDOperation.CREATE, message: "Error creating user." };
  }
};

/**
 * Searches/Finds/Reads for users in the database. If no criteria is provided, it returns all users.
 * @param id {string} - The ID of the user to read (optional)
 * @param username {string} - The username of the user to read (optional)
 * @param email {string} - The email of the user to read (optional)
 * @param phone {string} - The phone number of the user to read (optional)
 * @param role {UserRole} - The role of the user to read (optional)
 * @returns {UserCrudResult} - A promise that resolves to an object indicating success or failure.
 */
const readUser = async (
  id?: string,
  username?: string,
  email?: string,
  phone?: string,
  role?: UserRole,
): Promise<UserCrudResult> => {
  const searchConditions: object[] = [];
  if (id) searchConditions.push({ _id: id }); // Add support for searching by ID
  if (username) searchConditions.push({ username: username });
  if (email) searchConditions.push({ email: email });
  if (phone) searchConditions.push({ phone: phone });
  if (role) searchConditions.push({ role: role });

  const filterCriteriaString = searchConditions.length > 0
    ? searchConditions.map(cond => JSON.stringify(cond)).join(' OR ')
    : 'all users';

  try {
    if (searchConditions.length === 0) {
      logger.info(`Database: Reading all users.`);
      const foundUsers = await userModel.find({});
      const safeUsers = foundUsers.map(toIUserSafe);
      return {
        success: true,
        operation: CRUDOperation.READ,
        users: safeUsers,
      };
    } else {
      const query = { $or: searchConditions };
      logger.info(`Database: Reading users matching ANY of: ${filterCriteriaString}`);
      const foundUsers = await userModel.find(query);

      if (foundUsers.length === 0) {
        logger.info(`Database: No users found matching criteria: ${filterCriteriaString}`);
        return {
          success: true,
          operation: CRUDOperation.READ,
          users: [],
          message: "No users found matching the specified criteria.",
        };
      }

      // If searching by ID, return a single user in the `user` field
      if (id) {
        const user = foundUsers[0]; // Assume ID is unique
        return {
          success: true,
          operation: CRUDOperation.READ,
          user: toIUserSafe(user),
        };
      }

      const safeUsers = foundUsers.map(toIUserSafe);
      return {
        success: true,
        operation: CRUDOperation.READ,
        users: safeUsers,
      };
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading user with ID: ${id} and error message: ${error}`);
    return { success: false, operation: CRUDOperation.READ, message: "Error reading user." };
  }
};

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

/**
 * Deletes a user from the database by ID and cascade deletes all associated projects and segmentation masks.
 * Includes a safety check to prevent deletion of the last remaining administrator account.
 *
 * @async
 * @function deleteUser
 * @param {string} user_id - The ID of the user to delete.
 * @returns {Promise<UserCrudResult>} A promise that resolves to a `UserCrudResult` object.
 * - On success: `{ success: true, operation: CRUDOperation.DELETE, message: "User ... deleted successfully." }`.
 * - On failure (user not found): `{ success: false, operation: CRUDOperation.DELETE, message: "User ... does not exist." }`.
 * - On failure (attempting to delete last admin): `{ success: false, operation: CRUDOperation.DELETE, message: "Cannot delete the last administrator account" }`.
 * - On other errors: `{ success: false, operation: CRUDOperation.DELETE, message: "Error when deleting user." }`.
 */
const deleteUser = async (user_id: string): Promise<UserCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {

    // Check if the user exists
    const existingUser = await userModel.findOne({ _id: user_id });
    // Check if the user is an admin and if this is the last admin
    if (existingUser && existingUser.role === UserRole.Admin) {
      // Check if this is the last admin
      const adminCount = await userModel.countDocuments({ role: UserRole.Admin });
      if (adminCount <= 1) {
        logger.warn(`Database: Attempted to delete last admin user: ${existingUser.username}`);
        return { success: false, operation, message: 'Cannot delete the last administrator account' };
      }
    }
    if (!existingUser) {
      logger.warn(`Database: User ${user_id} does not exist.`);
      return { success: false, operation, message: `User ${user_id} does not exist.` };
    }
    // Delete the user
    await existingUser.deleteOne();
    // Check if the user was deleted successfully using readUser function
    const deletedUserResult = await readUser(user_id);
    if (deletedUserResult.success && deletedUserResult.users && deletedUserResult.users.length > 0) {
      // This condition should ideally not be met if deleteOne succeeded without error,
      // but it's kept as a safeguard based on the original code's logic.
      logger.warn(`Database: User ${deletedUserResult.user?._id} was not deleted successfully.`);
      return { success: false, operation, message: `User ${user_id} was not deleted successfully.` };
    }
    // User deleted successfully
    logger.info(`Database: User ${user_id} deleted successfully.`);
    return { success: true, operation, message: `User ${user_id} deleted successfully.` };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting user ${user_id} with error: ${error}.`);
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

/* Project Section */
/* Project Collection Creation */

// Create dimension schema for use in project schema (Nest Depth: 1)
const projectDimensionSchema = new Schema({
  width: { type: Number, required: true }, // X dimension of the image
  height: { type: Number, required: true }, // Y dimension of the image
  slices: { type: Number, required: true }, // Z dimension of the image (if applicable)
  frames: { type: Number, required: false }, // T dimension of the image (if applicable)
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create voxel size schema for use in project schema (Nest Depth: 1)
const projectVoxelsizeSchema = new Schema({
  x: { type: Number, required: true }, // Voxel size in the X dimension
  y: { type: Number, required: true }, // Voxel size in the Y dimension
  z: { type: Number, required: false }, // Voxel size in the Z dimension (if applicable)
  t: { type: Number, required: false }, // Voxel size in the T dimension (if applicable)
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Project Collection (Nest Depth: 0)
const projectSchema = new Schema<IProject>({
  // Identifiers
  // _id:  string; // MongoDB Object ID of the project
  userid: { type: String, required: true }, // MongoDB User ID of the user to whom the project belongs
  // User inputs
  name: { type: String, required: true }, // Name of the project
  originalfilename: { type: String, required: true }, // Original filename of the uploaded file
  isSaved: { type: Boolean, required: true, default: false }, // Indicates if the project is saved
  description: { type: String, required: false }, // Description of the project
  // File properties
  filename: { type: String, required: true }, // Server rename - e.g., userid_projid.nii - use new mongoose.Types.ObjectId() to pregenerate before creating document in DB
  filetype: { type: String, required: true, enum: Object.values(FileType) }, // MIME type of the file
  filesize: { type: Number, required: true }, // Size of the file in bytes
  filehash: { type: String, required: true }, // SHA256 hash of the file
  // Location-tracking
  basepath: { type: String, required: true }, // Base path for the file storage (e.g., S3 bucket URL)
  originalfilepath: { type: String, required: true }, // Original (nifti/dicom) file location (e.g., S3 bucket URL)
  extractedfolderpath: { type: String, required: true }, // Folder path for the extracted files (e.g., S3 bucket URL)

  // File specifics
  datatype: { type: String, required: true }, // Data type of the image (e.g., uint8, float32)
  dimensions: { type: projectDimensionSchema, required: true }, // Dimensions of the image (e.g., width, height, slices, frames)
  // Voxel size (future proofing for 3D segmentation)
  voxelsize: { type: projectVoxelsizeSchema, required: false }, // Voxel size of the image (e.g., x, y, z, t dimensions) - check for errors in the future (stored in nifti as pixdim = [?, 0.5, 0.5, 1.0, 2.0, 0, 0, 0])
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// Add validation to ensure userid exists before saving the project
projectSchema.pre('save', async function (next) {
  const userExists = await userModel.exists({ _id: this.userid });
  if (!userExists) {
    throw new Error('Referenced user does not exist');
  }
  next();
});
// When a project is deleted, delete ALL associated segmentation masks
// THE S3 FILES STILL EXIST, API SIDE?
projectSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  const serviceLocationCascade = `${serviceLocation} - Project Delete Hook`;
  try {
    logger.info(`Database: Cascade delete triggered for project ${this._id}`);
    // Delete all masks associated with this project
    const maskDeleteResult = await projectSegmentationMaskModel.deleteMany({ projectid: this._id });
    logger.info(`Database: Deleted ${maskDeleteResult.deletedCount} segmentation masks for project ${this._id}`);
    next(); // Proceed to project deletion
  } catch (error: unknown) {
    LogError(error as Error, serviceLocationCascade, `Error during cascade delete for project ${this._id}.`);
    // Halt the original project deletion by passing the error
    next(error instanceof Error ? error : new Error('Failed to cascade delete segmentation masks'));
  }
});
// Create the model with proper typing
const projectModel = model<IProject, Model<IProject>>("Project", projectSchema);

// Project Segmentation Mask Collection
// Create bounding box schema for use in project segmentation mask schema's slice schema (Nest Depth: 3)
const projectSegmentationMaskSliceComponentBoundingBoxesSchema = new Schema({
  class: { type: String, required: true, enum: Object.values(ComponentBoundingBoxesClass) }, // Class of the bounding box (rv, myo, lvc)
  x_min: { type: Number, required: true }, // Minimum X coordinate of the bounding box
  y_min: { type: Number, required: true }, // Minimum Y coordinate of the bounding box
  x_max: { type: Number, required: true }, // Maximum X coordinate of the bounding box
  y_max: { type: Number, required: true }, // Maximum Y coordinate of the bounding box
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create slice schema (Nest Depth: 2)
const projectSegmentationMaskSliceSchema = new Schema({
  sliceindex: { type: Number, required: true }, // Index of the slice (0-based)
  componentboundingboxes: [{ type: projectSegmentationMaskSliceComponentBoundingBoxesSchema, required: false }], // Array of component bounding boxes for the slicesegmentation mask image (e.g., S3 bucket URL) - assume CSV? or RLE?
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create frames schema (Nest Depth: 1)
const projectSegmentationMaskFramesSchema = new Schema({
  frameindex: { type: Number, required: true }, // Index of the frame (0-based)
  frameinferred: { type: Boolean, required: true, default: false }, // Indicates if the frame is inferred (update if user runs MedSAM on the frame)
  slices: { type: [projectSegmentationMaskSliceSchema], required: true }, // Array of slices for the frame
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create Segmentation mask schema (Nest Depth: 0)
const projectSegmentationMaskSchema = new Schema<IProjectSegmentationMask>({
  // Identifiers
  projectid: { type: String, required: true }, // MongoDB Project ID of the project to which the segmentation mask belongs
  // User inputs
  name: { type: String, required: true }, // Name of the segmentation mask
  description: { type: String, required: false }, // Description of the segmentation mask
  isSaved: { type: Boolean, required: true, default: false }, // Indicates if the segmentation mask is saved
  segmentationmaskpath: { type: String, required: false }, // Path to the segmentation mask file (e.g., S3 bucket URL)
  segmentationmaskRLE: { type: Boolean, required: false }, // RLE of the segmentation mask (e.g., S3 bucket URL)
  isMedSAMOutput: { type: Boolean, required: true, default: false }, // Indicates if the segmentation mask is a MedSAM output
  // Properties of extracted folder + location tracking
  // Index should be 0 based
  frames: [{ type: projectSegmentationMaskFramesSchema, required: true }], // Array of frames for the segmentation mask
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps

// Create the model with proper typing
// Hooks for pre-save and pre-delete operations (must be before the model creation)
// Add validation to ensure projectid exists before saving
projectSegmentationMaskSchema.pre('save', async function (next) {
  const projectExists = await projectModel.exists({ _id: this.projectid });
  if (!projectExists) {
    throw new Error('Referenced project does not exist');
  }
  next();
});
const projectSegmentationMaskModel = model<IProjectSegmentationMask, Model<IProjectSegmentationMask>>("Segmentation Masks", projectSegmentationMaskSchema);

// Add an index to improve query performance
projectSchema.index({ userid: 1, name: 1 }, { unique: true }); // Unique index on userid and name
projectSegmentationMaskSchema.index({ projectid: 1 });

/**
 * Creates a new project record in the database.
 * Performs checks to ensure uniqueness constraints are met before creation.
 * Uniqueness checks include:
 * - Project name must be unique per user.
 * - File hash must be unique per user.
 * - Original file path must be globally unique.
 * - Extracted folder path must be globally unique.
 * - Server-generated filename must be globally unique.
 * 
 * @async
 * @function createProject
 * @param {string} userid - The ID of the user creating the project.
 * @param {string} name - The name for the new project (must be unique for this user).
 * @param {string} originalfilename - The original name of the uploaded file.
 * @param {boolean} isSaved - Indicates if the file should be saved (true) or not (false).
 * @param {string} filename - The server-generated unique filename, preferably using the format `userid_filehash.nii` as ObjectId has not been generated yet.
 * @param {FileType} filetype - The MIME type of the uploaded file.
 * @param {number} filesize - The size of the uploaded file in bytes.
 * @param {string} filehash - The SHA256 hash of the uploaded file content.
 * @param {string} basepath - The base storage path (e.g., S3 bucket URL).
 * @param {string} originalfilepath - The unique path/key where the original file is stored.
 * @param {string} extractedfolderpath - The unique path/key to the folder where extracted files (e.g., JPEGs) will be stored.
 * @param {FileDataType} datatype - The data type of the image pixels (e.g., float32, uint8).
 * @param {object} dimensions - The dimensions of the image.
 * @param {number} dimensions.width - Image width in pixels.
 * @param {number} dimensions.height - Image height in pixels.
 * @param {number} dimensions.slices - Number of slices (depth).
 * @param {number} [dimensions.frames] - Optional number of time frames (for 4D data).
 * @param {object} [voxelsize] - Optional physical voxel dimensions.
 * @param {number} voxelsize.x - Voxel size in the x-dimension (mm).
 * @param {number} voxelsize.y - Voxel size in the y-dimension (mm).
 * @param {number} [voxelsize.z] - Optional voxel size in the z-dimension (mm).
 * @param {number} [voxelsize.t] - Optional voxel size in the t-dimension (e.g., seconds).
 * @param {string} [description] - Optional description for the project.
 * @returns {Promise<ProjectCrudResult>} A promise resolving to a ProjectCrudResult object.
 * - On success: `{ success: true, operation: CRUDOperation.CREATE, project: IProjectDocument }`
 * - On uniqueness conflict: `{ success: false, operation: CRUDOperation.CREATE, message: string }` detailing the conflict.
 * - On database error: `{ success: false, operation: CRUDOperation.CREATE, message: "Error creating project." }`
 */
const createProject = async (
  userid: string,
  name: string, // User-given name of the project (must be unique for the user)
  originalfilename: string, // The original name of the file when uploaded
  isSaved: boolean, // Indicates if the file should be saved (true) or not (false)
  filename: string, // server generated filename in the format of userid_filehash.nii (e.g., 1234567890_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii)
  filetype: FileType, // MIME type of the file (e.g., image/nifti, image/dicom) - should be detected by server
  filesize: number, // In bytes
  filehash: string, // SHA256 hash of the file (to be generated by the API developers)
  basepath: string, // Base path for the file storage (e.g., S3 bucket URL)
  originalfilepath: string, // Original file location (e.g., S3 bucket URL)
  extractedfolderpath: string, // Folder path for the extracted files (e.g., S3 bucket URL)
  datatype: FileDataType, // Data type of the image (e.g., uint8, float32) - should be detected by server
  dimensions: { width: number; height: number; slices: number; frames?: number },
  voxelsize?: { x: number; y: number; z?: number; t?: number }, // Optional physical voxel dimensions (e.g., x, y, z, t dimensions) - should be detected by server
  description?: string, // User-given description of the project (optional)
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.CREATE;
  try {
    // If user does not exist, return error
    const user = await userModel.findById(userid);
    if (!user) {
      logger.warn(`Database: User ${userid} does not exist.`);
      return { success: false, operation, message: `User ${userid} does not exist.` };
    }

    // Validate input parameters
    // Check if all the string inputs are non-empty strings
    const stringInputs = [userid, name, originalfilename, filename, filehash, basepath, originalfilepath, extractedfolderpath, datatype];
    const emptyStringInputs = stringInputs.filter(input => !input || typeof input !== 'string' || input.trim() === '');
    if (emptyStringInputs.length > 0) {
      logger.warn(`Database: Invalid input parameters for project creation: ${emptyStringInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid input parameters for project creation: ${emptyStringInputs.join(", ")}` };
    }
    // Check if the numeric inputs are valid numbers
    if (isNaN(filesize) || isNaN(dimensions.width) || isNaN(dimensions.height) || isNaN(dimensions.slices)) {
      logger.warn(`Database: Invalid numeric input parameters for project creation: ${JSON.stringify({ filesize, dimensions })}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project creation.` };
    }
    // Check if all numeric inputs are more than 0
    const numericInputs = [filesize, dimensions.width, dimensions.height, dimensions.slices];
    const negativeNumericInputs = numericInputs.filter(input => input <= 0);
    if (negativeNumericInputs.length > 0) {
      logger.warn(`Database: Invalid numeric input parameters for project creation: ${negativeNumericInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project creation.` };
    }
    // Check that voxelSize inputs are more than 0 if provided
    if (voxelsize) {
      const voxelNumericInputs = [voxelsize.x, voxelsize.y, voxelsize.z, voxelsize.t].filter(input => (input ?? 0) <= 0);
      if (voxelNumericInputs.length > 0) {
        logger.warn(`Database: Invalid voxel size input parameters for project creation: ${voxelNumericInputs.join(", ")}`);
        return { success: false, operation, message: `Invalid voxel size input parameters for project creation.` };
      }
    }

    // Check conflicting fields (name, filehash, originalfilepath, extractedfolderpath, filename) 
    const existingProject = await projectModel.findOne({
      $or: [
        { userid: userid, name: name }, // User must not have a project with the same name
        { userid: userid, filehash: filehash }, // User must not have a project with the same filehash
        { originalfilepath: originalfilepath },
        { extractedfolderpath: extractedfolderpath },
        { filename: filename },
      ],
    });
    // If conflicts found, aggregate reasons and return error
    if (existingProject) {
      let reasons = `Project creation failed due to uniqueness constraint violation:`; // Starting error message
      if (existingProject.userid === userid && existingProject.name === name) reasons += ` Name "${name}" already exists for this user.`;
      if (existingProject.userid === userid && existingProject.filehash === filehash) reasons += ` File hash "${filehash}" already exists for this user.`;
      if (existingProject.originalfilepath === originalfilepath) reasons += ` Original filepath "${originalfilepath}" is already in use globally.`;
      if (existingProject.extractedfolderpath === extractedfolderpath) reasons += ` Extracted folder path "${extractedfolderpath}" is already in use globally.`;
      if (existingProject.filename === filename) reasons += ` Server filename "${filename}" is already in use globally.`;
      logger.warn(`Database: Error creating project: ${reasons}`);
      return { success: false, operation, message: reasons };
    }

    // Create new project instance
    const newProject: IProjectDocument = new projectModel({
      userid: userid,
      name: name,
      originalfilename: originalfilename,
      isSaved: isSaved,
      filename: filename,
      filetype: filetype,
      filesize: filesize,
      filehash: filehash,
      basepath: basepath,
      originalfilepath: originalfilepath,
      extractedfolderpath: extractedfolderpath,
      datatype: datatype,
      dimensions: dimensions,
      voxelsize: voxelsize, // Optional
      description: description, // Optional
    });
    // Save the new project to the database
    await newProject.save();

    logger.info(`Database: Project ${newProject._id} created successfully: ${newProject.name}, ${newProject.originalfilename}, ${newProject.filename}, ${newProject.filehash}`);
    return { success: true, operation, project: newProject }; // Return the created project
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating project.`);
    return { success: false, operation: CRUDOperation.CREATE, message: "Error creating project." };
  }
}

/**
 * Reads/searches for projects in the database based on various optional criteria.
 * Dynamically constructs a MongoDB query based on the provided parameters.
 * Supports filtering by ID, user, name (case-insensitive), description (case-insensitive),
 * saved status, filename (case-insensitive), file types (array), file size range,
 * data types (array), dimension ranges (AND logic), voxel size ranges (OR logic),
 * and creation date range.
 *
 * @async
 * @function readProject
 * @param {string} [projectid] - Optional project ID to find a specific project.
 * @param {string} [userid] - Optional user ID to filter projects by owner.
 * @param {string} [name] - Optional project name fragment for case-insensitive search.
 * @param {string} [description] - Optional description fragment for case-insensitive search.
 * @param {boolean} [isSaved] - Optional boolean to filter by saved status.
 * @param {string} [filename] - Optional filename fragment for case-insensitive search.
 * @param {FileType[]} [filetype] - Optional array of file types (e.g., [FileType.NIFTI]) to filter by.
 * @param {object} [filesize] - Optional object defining a file size range.
 * @param {number} [filesize.minsize] - Minimum file size (inclusive).
 * @param {number} [filesize.maxsize] - Maximum file size (inclusive).
 * @param {FileDataType[]} [datatype] - Optional array of data types to filter by.
 * @param {object} [dimensions] - Optional object defining dimension ranges. All provided dimension ranges must be met (AND logic).
 * @param {object} [dimensions.width] - Width range { minsize?, maxsize? }.
 * @param {object} [dimensions.height] - Height range { minsize?, maxsize? }.
 * @param {object} [dimensions.slices] - Slices range { minsize?, maxsize? }.
 * @param {object} [dimensions.frames] - Frames range { minsize?, maxsize? }.
 * @param {object} [voxelsize] - Optional object defining voxel size ranges. At least one provided voxel size range must be met (OR logic).
 * @param {object} [voxelsize.x] - Voxel X range { minsize?, maxsize? }.
 * @param {object} [voxelsize.y] - Voxel Y range { minsize?, maxsize? }.
 * @param {object} [voxelsize.z] - Voxel Z range { minsize?, maxsize? }.
 * @param {object} [voxelsize.t] - Voxel T range { minsize?, maxsize? }.
 * @param {object} [daterange] - Optional object defining a creation date range.
 * @param {Date} [daterange.start] - Start date (inclusive).
 * @param {Date} [daterange.end] - End date (inclusive).
 * @returns {Promise<ProjectCrudResult>} A promise resolving to a ProjectCrudResult object.
 * - On success with results: `{ success: true, operation: CRUDOperation.READ, projects: IProjectDocument[] }`.
 * - On success with no results: `{ success: true, operation: CRUDOperation.READ, message: "No projects found..." }`.
 * - On error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading projects." }`.
 */
const readProject = async (
  projectid?: string,
  userid?: string,
  name?: string,
  description?: string,
  isSaved?: boolean,
  filename?: string,
  filetype?: FileType[], // array of file types to filter by (e.g., [FileType.NIFTI, FileType.DICOM])
  filesize?: { minsize?: number; maxsize?: number },
  datatype?: FileDataType[],
  dimensions?: { width?: { minsize?: number; maxsize?: number }, height?: { minsize?: number; maxsize?: number }, slices?: { minsize?: number; maxsize?: number }, frames?: { minsize?: number; maxsize?: number }, },
  voxelsize?: { x?: { minsize?: number; maxsize?: number }, y?: { minsize?: number; maxsize?: number }, z?: { minsize?: number; maxsize?: number }, t?: { minsize?: number; maxsize?: number }, },
  daterange?: { start?: Date; end?: Date },
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.READ;
  // validate input parameters
  const searchConditions: object[] = []; // Array to hold search conditions for the query
  if (projectid) searchConditions.push({ _id: projectid }); // Search by project ID
  if (userid) searchConditions.push({ userid: userid }); // Search by user ID
  if (name) searchConditions.push({ name: { $regex: new RegExp(name, 'i') } }); // Case-insensitive search by name
  if (description) searchConditions.push({ description: { $regex: new RegExp(description, 'i') } }); // Case-insensitive search by description
  if (isSaved !== undefined) searchConditions.push({ isSaved: isSaved }); // Search by saved status
  if (filename) searchConditions.push({ filename: { $regex: new RegExp(filename, 'i') } }); // Case-insensitive search by filename
  if (filetype) searchConditions.push({ filetype: { $in: filetype } }); // Search by file type
  if (filesize) {
    if (filesize.minsize) searchConditions.push({ filesize: { $gte: filesize.minsize } }); // Search by minimum file size
    if (filesize.maxsize) searchConditions.push({ filesize: { $lte: filesize.maxsize } }); // Search by maximum file size
  }
  if (datatype) searchConditions.push({ datatype: { $in: datatype } }); // Search by data type
  if (dimensions) searchConditions.push({
    $and: [
      dimensions.width?.minsize ? { 'dimensions.width': { $gte: dimensions.width.minsize } } : {},
      dimensions.width?.maxsize ? { 'dimensions.width': { $lte: dimensions.width.maxsize } } : {},
      dimensions.height?.minsize ? { 'dimensions.height': { $gte: dimensions.height.minsize } } : {},
      dimensions.height?.maxsize ? { 'dimensions.height': { $lte: dimensions.height.maxsize } } : {},
      dimensions.slices?.minsize ? { 'dimensions.slices': { $gte: dimensions.slices.minsize } } : {},
      dimensions.slices?.maxsize ? { 'dimensions.slices': { $lte: dimensions.slices.maxsize } } : {},
      dimensions.frames?.minsize ? { 'dimensions.frames': { $gte: dimensions.frames.minsize } } : {},
      dimensions.frames?.maxsize ? { 'dimensions.frames': { $lte: dimensions.frames.maxsize } } : {},
    ]
  });
  if (voxelsize) searchConditions.push({
    $or: [
      voxelsize.t?.minsize ? { 'voxelsize.t': { $gte: voxelsize.t.minsize } } : {},
      voxelsize.t?.maxsize ? { 'voxelsize.t': { $lte: voxelsize.t.maxsize } } : {},

      voxelsize.x?.minsize ? { 'voxelsize.x': { $gte: voxelsize.x.minsize } } : {},
      voxelsize.x?.maxsize ? { 'voxelsize.x': { $lte: voxelsize.x.maxsize } } : {},

      voxelsize.y?.minsize ? { 'voxelsize.y': { $gte: voxelsize.y.minsize } } : {},
      voxelsize.y?.maxsize ? { 'voxelsize.y': { $lte: voxelsize.y.maxsize } } : {},

      voxelsize.z?.minsize ? { 'voxelsize.z': { $gte: voxelsize.z.minsize } } : {},
      voxelsize.z?.maxsize ? { 'voxelsize.z': { $lte: voxelsize.z.maxsize } } : {},

    ]
  });
  if (daterange) {
    if (daterange.start) searchConditions.push({ createdAt: { $gte: daterange.start } }); // Search by start date
    if (daterange.end) searchConditions.push({ createdAt: { $lte: daterange.end } }); // Search by end date
  }
  // If no search conditions are provided, return all projects
  if (searchConditions.length === 0) {
    logger.warn(`Database: No search conditions provided. Returning all projects.`);
    // Remove .lean() to return Mongoose documents (IProjectDocument) instead of plain objects
    return { success: true, operation, projects: await projectModel.find({}) }; // Return all projects as Mongoose documents
  }

  // If there are search conditions, build the query
  const query = { $and: searchConditions }; // Combine all conditions with $and
  logger.info(`Database: Reading projects matching query: ${JSON.stringify(query)}`);

  try {
    const projects = await projectModel.find(query); // Execute the query

    if (projects.length === 0) {
      logger.info(`Database: No projects found matching the criteria.`);
      return { success: true, operation, message: "No projects found matching the criteria." };
    }

    logger.info(`Database: Found ${projects.length} projects matching the criteria.`);
    return { success: true, operation, projects: projects }; // Return found projects as Mongoose documents

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading projects with query: ${JSON.stringify(query)}`);
    return { success: false, operation, message: "Error reading projects." };
  }
}

// updateProject function
const updateProject = async (
  // Identifying parameters:
  projectid: string, // The ID of the project to update (unique)
  // Update object
  updates: {
    userid?: string,
    name?: string, // User-given name of the project (must be unique for the user)
    originalfilename?: string, // The original name of the file when uploaded
    isSaved?: boolean, // Indicates if the file should be saved (true) or not (false)
    filename?: string, // server generated filename in the format of userid_filehash.nii (e.g., 1234567890_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii)
    filetype?: FileType, // MIME type of the file (e.g., image/nifti, image/dicom) - should be detected by server
    filesize?: number, // In bytes
    filehash?: string, // SHA256 hash of the file (to be generated by the API developers)
    basepath?: string, // Base path for the file storage (e.g., S3 bucket URL)
    originalfilepath?: string, // Original file location (e.g., S3 bucket URL)
    extractedfolderpath?: string, // Folder path for the extracted files (e.g., S3 bucket URL)
    datatype?: FileDataType, // Data type of the image (e.g., uint8, float32) - should be detected by server
    dimensions?: { width?: number; height?: number; slices?: number; frames?: number },
    voxelsize?: { x?: number; y?: number; z?: number; t?: number }, // Optional physical voxel dimensions (e.g., x, y, z, t dimensions) - should be detected by server
    description?: string, // User-given description of the project (optional)
  }
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  // Look for the project by id
  const project = await projectModel.findById(projectid);
  if (!project) {
    logger.warn(`Database: Project ${projectid} not found.`);
    return { success: false, operation, message: `Project ${projectid} not found.` };
  }
  try {
    if (updates.userid) project.userid = updates.userid; // Update user ID if provided
    if (updates.name) project.name = updates.name; // Update project name if provided
    if (updates.originalfilename) project.originalfilename = updates.originalfilename;
    if (updates.isSaved !== undefined) project.isSaved = updates.isSaved; // Update saved status if provided
    if (updates.filename) project.filename = updates.filename; // Update server filename if provided
    if (updates.filetype) project.filetype = updates.filetype; // Update file type if provided
    if (updates.filesize) project.filesize = updates.filesize; // Update file size if provided
    if (updates.filehash) project.filehash = updates.filehash; // Update file hash if provided
    if (updates.basepath) project.basepath = updates.basepath; // Update base path if provided
    if (updates.originalfilepath) project.originalfilepath = updates.originalfilepath; // Update original file path if provided
    if (updates.extractedfolderpath) project.extractedfolderpath = updates.extractedfolderpath; // Update extracted folder path if provided
    if (updates.datatype) project.datatype = updates.datatype; // Update data type if provided
    // Dimensions updates
    if (updates.dimensions) {
      if (updates.dimensions.width) project.dimensions.width = updates.dimensions.width;
      if (updates.dimensions.height) project.dimensions.height = updates.dimensions.height;
      if (updates.dimensions.slices) project.dimensions.slices = updates.dimensions.slices;
      if (updates.dimensions.frames) project.dimensions.frames = updates.dimensions.frames;
    }
    // Voxel size updates
    if (updates.voxelsize) {
      // Initialize voxelsize object if it doesn't exist
      if (!project.voxelsize) {
        project.voxelsize = { x: 0, y: 0 }; // Initialize with required fields
      }
      if (updates.voxelsize.x) project.voxelsize.x = updates.voxelsize.x;
      if (updates.voxelsize.y) project.voxelsize.y = updates.voxelsize.y;
      if (updates.voxelsize.z) project.voxelsize.z = updates.voxelsize.z;
      if (updates.voxelsize.t) project.voxelsize.t = updates.voxelsize.t;
    }
    if (updates.description) project.description = updates.description; // Update description if provided

    // Save the updated project to the database
    await project.save();

    logger.info(`Database: Project ${project._id} updated successfully.`);
    return { success: true, operation, project: project }; // Return the updated project
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating project ${projectid} with error: ${error}.`);
    return { success: false, operation, message: "Error updating project." };
  }
}

/**
 * Deletes a project from the database by ID, triggering cascade deletion of all associated segmentation masks.
 * 
 * @async
 * @function deleteProject
 * @param {string} projectid - The ID of the project to delete
 * @returns {Promise<ProjectCrudResult>} Result object with success status, operation type, and message
 * - Success: {success: true, operation: DELETE, message: "Project deleted successfully"}
 * - Not found: {success: false, operation: DELETE, message: "Project not found"}
 * - Error: {success: false, operation: DELETE, message: "Error deleting project"}
 */
const deleteProject = async (projectid: string): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    // Find the project by ID
    const project = await projectModel.findById(projectid);
    if (!project) {
      logger.warn(`Database: Project ${projectid} not found.`);
      return { success: false, operation, message: `Project ${projectid} not found.` };
    }
    // Delete the project
    await project.deleteOne();
    logger.info(`Database: Project ${project._id} deleted successfully.`);
    return { success: true, operation, message: `Project ${project._id} deleted successfully.` };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting project ${projectid}.`);
    return { success: false, operation, message: "Error deleting project." };
  }
}

/* Project Segmentation Mask section */

/**
 * Creates a new project segmentation mask record in the database.
 * Validates the provided data, including checking for the existence of the referenced project ID,
 * ensuring string inputs are not empty, and numeric inputs (indices, coordinates) are non-negative.
 *
 * @async
 * @function createProjectSegmentationMask
 * @param {IProjectSegmentationMask} projectsegmentationmask - An object containing the details of the segmentation mask to create. Import this interface from the database's types file.
 * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success: `{ success: true, operation: CREATE, projectsegmentationmask: IProjectSegmentationMaskDocument }` containing the created mask document.
 * - On failure (project not found): `{ success: false, operation: CREATE, message: "Project ID ... does not exist." }`.
 * - On failure (invalid input): `{ success: false, operation: CREATE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: CREATE, message: "Error creating project segmentation mask." }`.
 */
const createProjectSegmentationMask = async (
  projectsegmentationmask: IProjectSegmentationMask
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.CREATE;
  const psm = projectsegmentationmask;
  try {
    // Validate the project ID 
    const projectid = projectsegmentationmask.projectid;
    const projectidexists = await projectModel.exists({ _id: projectid });
    if (!projectidexists) {
      logger.warn(`Database: Project ID ${projectid} does not exist.`);
      return { success: false, operation, message: `Project ID ${projectid} does not exist.` };
    }
    // Validate the contents
    // Check if same name exists
    const projectsegmasknameexists = await projectSegmentationMaskModel.exists({ name: psm.name, projectid: psm.projectid })
    if (projectsegmasknameexists) {
      logger.warn(`Database: Invalid input parameters for project segmentation mask creation: Segmentation mask name ${psm.name} already exists for this project.`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: Segmentation mask name ${psm.name} already exists for this project.` };
    }
    // Validate empty strings 
    const stringInputs = [
      psm.name,
    ]
    if (psm.segmentationmaskpath) stringInputs.push(psm.segmentationmaskpath); // Optional field
    const emptyStringInputs = stringInputs.filter(input => !input || typeof input !== 'string' || input.trim() === '');
    if (emptyStringInputs.length > 0) {
      logger.warn(`Database: Invalid input parameters for project segmentation mask creation: ${emptyStringInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: ${emptyStringInputs.join(", ")}` };
    }
    // Validate numeric inputs
    const numericInputs = [
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.sliceindex)),
      ...psm.frames.flatMap(frame => frame.frameindex),
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.componentboundingboxes?.map(box => box.x_min) || [])),
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.componentboundingboxes?.map(box => box.y_min) || [])),
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.componentboundingboxes?.map(box => box.x_max) || [])),
      ...psm.frames.flatMap(frame => frame.slices.map(slices => slices.componentboundingboxes?.map(box => box.y_max) || [])),
    ];
    const negativeNumericInputs = numericInputs.filter(input => typeof input === 'number' && input < 0);
    if (negativeNumericInputs.length > 0) {
      logger.warn(`Database: Invalid numeric input parameters for project segmentation mask creation: ${negativeNumericInputs.join(", ")}`);
      return { success: false, operation, message: `Invalid numeric input parameters for project segmentation mask creation.` };
    }
    // Validate that bounding boxes's x_max >= x_min and y_max >= y_min
    const invalidBoundingBoxes = psm.frames.flatMap(frame => frame.slices.flatMap(slices => slices.componentboundingboxes?.filter(box => box.x_max < box.x_min || box.y_max < box.y_min) || []));
    if (invalidBoundingBoxes.length > 0) {
      const invalidBoundingBoxesResult = invalidBoundingBoxes.map(box => `(${box.x_min}, ${box.y_min}) to (${box.x_max}, ${box.y_max})`).join(", ");
      logger.warn(`Database: Invalid bounding box coordinates for project segmentation mask creation: ${invalidBoundingBoxesResult}`);
      return { success: false, operation, message: `Invalid bounding box coordinates for project segmentation mask creation: ${invalidBoundingBoxesResult}.` };
    }
    // Validate that frames array is populated
    if (!psm.frames || !Array.isArray(psm.frames) || psm.frames.length === 0) {
      logger.warn(`Database: Invalid input parameters for project segmentation mask creation: frames array must be populated with at least one frame.`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: frames array must be populated with at least one frame.` };
    }

    // Validate that each frame has a slices array that is populated
    const framesWithEmptySlices = psm.frames.filter(frame =>
      !frame.slices || !Array.isArray(frame.slices) || frame.slices.length === 0
    );

    if (framesWithEmptySlices.length > 0) {
      const frameindexesWithEmptySlices = framesWithEmptySlices.map(frame => frame.frameindex).join(", ");
      logger.warn(`Database: Invalid input parameters for project segmentation mask creation: frames with indexes [${frameindexesWithEmptySlices}] have empty slices arrays.`);
      return { success: false, operation, message: `Invalid input parameters for project segmentation mask creation: each frame must have at least one slice.` };
    }


    // Create new project segmentation mask instance
    const newProjectSegmentationMask = new projectSegmentationMaskModel(psm);

    // Save the new project segmentation mask to the database
    const result = await newProjectSegmentationMask.save();
    if (!result) {
      logger.warn(`Database: Error creating project segmentation mask.`);
      return { success: false, operation, message: "Error creating project segmentation mask." };
    }
    logger.info(`Database: Project segmentation mask ${result._id} created successfully.`);
    return { success: true, operation, projectsegmentationmask: result }; // Return the created project segmentation mask
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error creating project segmentation mask." };
  }
}

/**
 * Reads all segmentation masks associated with a specific project ID.
 * Validates the existence of the project ID before querying the database.
 *
 * @async
 * @function readProjectSegmentationMask
 * @param {string} projectid - The ID of the project whose segmentation masks are to be retrieved.
 * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success with results: `{ success: true, operation: CRUDOperation.READ, projectsegmentationmasks: IProjectSegmentationMaskDocument[] }`.
 * - On success with no results: `{ success: true, operation: CRUDOperation.READ, message: "No segmentation masks found for this project." }`.
 * - On failure (project not found): `{ success: false, operation: CRUDOperation.READ, message: "Project ID ... does not exist." }`.
 * - On database error: `{ success: false, operation: CRUDOperation.READ, message: "Error reading project segmentation mask." }`.
 */
const readProjectSegmentationMask = async (
  projectid: string,
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.READ;
  try {
    // validate the project id
    const projectidexists = await projectModel.exists({ _id: projectid });
    if (!projectidexists) {
      logger.warn(`Database: Project ID ${projectid} does not exist.`);
      return { success: false, operation, message: `Project ID ${projectid} does not exist.` }; // Project ID does not exist
    }
    // Find all segmentation masks for the project
    const projectSegmentationMasks = await projectSegmentationMaskModel.find({ projectid: projectid });
    if (!projectSegmentationMasks || projectSegmentationMasks.length === 0) {
      logger.info(`Database: No segmentation masks found for project ID ${projectid}.`);
      return { success: true, operation, message: "No segmentation masks found for this project." }; // true success, but no results found
    }
    logger.info(`Database: Found ${projectSegmentationMasks.length} segmentation masks for project ID ${projectid}.`);
    return { success: true, operation, projectsegmentationmasks: projectSegmentationMasks }; // Return the found segmentation masks

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error reading project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error reading project segmentation mask." };
  }
}

/**
 * Updates an existing project segmentation mask in the database.
 * Validates the existence of the mask ID and the project ID before applying updates.
 * Checks for uniqueness of the name and validates the contents of the mask.
 * Should be used for large updates, as it almost replaces the entire mask object (especially the frame).
 * 
 * @async
 * @function updateProjectSegmentationMask
 * @param {string} maskid - The ID of the segmentation mask to update.
 * @param {Partial<IProjectSegmentationMaskDocument>} maskupdates - An object containing the updates to apply to the segmentation mask.
 * * @returns {Promise<ProjectSegmentationMaskCrudResult>} A promise resolving to a ProjectSegmentationMaskCrudResult object.
 * - On success: `{ success: true, operation: CRUDOperation.UPDATE, projectsegmentationmask: IProjectSegmentationMaskDocument }` containing the updated mask document.
 * - On failure (mask not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "Segmentation mask ID ... does not exist." }`.
 * - On failure (project not found): `{ success: false, operation: CRUDOperation.UPDATE, message: "Project ID ... does not exist." }`.
 * - On failure (invalid input): `{ success: false, operation: CRUDOperation.UPDATE, message: "Invalid input parameters..." }`.
 * - On database error: `{ success: false, operation: CRUDOperation.UPDATE, message: "Error updating project segmentation mask." }`.
 */
const updateProjectSegmentationMask = async (
  maskid: string,
  maskupdates: Partial<IProjectSegmentationMaskDocument>
): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.UPDATE;
  try {
    // Find the segmentation mask by ID
    const mask = await projectSegmentationMaskModel.findById(maskid);
    if (!mask) {
      logger.warn(`Database: Project segmentation mask ${maskid} not found.`);
      return { success: false, operation, message: `Project segmentation mask ${maskid} not found.` };
    }

    // Validate updates based on what's being changed

    // 1. If updating name, check for uniqueness
    if (maskupdates.name && maskupdates.name !== mask.name) {
      const nameExists = await projectSegmentationMaskModel.exists({
        projectid: mask.projectid,
        name: maskupdates.name,
        _id: { $ne: maskid }
      });

      if (nameExists) {
        return { success: false, operation, message: `Segmentation mask name '${maskupdates.name}' already exists for this project.` };
      }

      // Set the name property directly
      mask.name = maskupdates.name;
    }

    // 2. Update description if provided
    if (maskupdates.description !== undefined) {
      mask.description = maskupdates.description;
    }

    // 3. Update saved status if provided
    if (maskupdates.isSaved !== undefined) {
      mask.isSaved = maskupdates.isSaved;
    }

    // 4. Update MedSAM output status if provided
    if (maskupdates.isMedSAMOutput !== undefined) {
      mask.isMedSAMOutput = maskupdates.isMedSAMOutput;
    }

    // 5. Handle frames update - requires special validation
    if (maskupdates.frames) {
      // Validate frames exist and are not empty
      if (!Array.isArray(maskupdates.frames) || maskupdates.frames.length === 0) {
        return { success: false, operation, message: "Frames array must contain at least one frame." };
      }

      // Validate each frame has a valid index
      const invalidFrameIndices = maskupdates.frames.filter(frame =>
        frame.frameindex === undefined || typeof frame.frameindex !== 'number' || frame.frameindex < 0
      );
      if (invalidFrameIndices.length > 0) {
        const indices = invalidFrameIndices.map(f => f.frameindex).join(", ");
        return { success: false, operation, message: `Invalid frame indices: [${indices}]. Frame index must be a non-negative number.` };
      }

      // Validate each frame has slices
      const framesWithEmptySlices = maskupdates.frames.filter(frame =>
        !frame.slices || !Array.isArray(frame.slices) || frame.slices.length === 0
      );

      if (framesWithEmptySlices.length > 0) {
        const indices = framesWithEmptySlices.map(f => f.frameindex).join(", ");
        return { success: false, operation, message: `Frames with indices [${indices}] must have at least one slice.` };
      }

      // Validate bounding boxes
      const invalidBoundingBoxes = maskupdates.frames.flatMap(frame =>
        frame.slices.flatMap(slice =>
          slice.componentboundingboxes?.filter(box =>
            box.x_max < box.x_min || box.y_max < box.y_min
          ) || []
        )
      );

      if (invalidBoundingBoxes.length > 0) {
        return { success: false, operation, message: "Invalid bounding box coordinates: max values must be greater than or equal to min values." };
      }

      // Update the entire frames array if all validations pass
      mask.frames = maskupdates.frames;
    }

    // Save the updated document
    await mask.save();

    logger.info(`Database: Project segmentation mask ${maskid} updated successfully.`);
    return { success: true, operation, projectsegmentationmask: mask };

  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating project segmentation mask, ${error}`);
    return { success: false, operation, message: "Error updating project segmentation mask." };
  }
};

// deleteProjectSegmentationMask function
const deleteProjectSegmentationMask = async (maskid: string): Promise<ProjectSegmentationMaskCrudResult> => {
  const operation = CRUDOperation.DELETE;
  try {
    // Find the segmentation mask by ID
    const mask = await projectSegmentationMaskModel.findById(maskid);
    if (!mask) {
      logger.warn(`Database: Project segmentation mask ${maskid} not found.`);
      return { success: false, operation, message: `Project segmentation mask ${maskid} not found.` };
    }
    // Delete the segmentation mask
    await mask.deleteOne();
    logger.info(`Database: Project segmentation mask ${mask._id} deleted successfully.`);
    return { success: true, operation, message: `Project segmentation mask ${mask._id} deleted successfully.` };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error deleting project segmentation mask ${maskid}.`);
    return { success: false, operation, message: "Error deleting project segmentation mask." };
  }
}

// Auxiliary Project Segmentation Mask functions
// For granular updates, such as adding/removing slices or frames
// const 

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
// ONLY unit tests should use userModel, fileModel directly, otherwise use the created functions to create users/files.
export { connectToDatabase, userModel, createUser, readUser, updateUser, deleteUser, authenticateUser, UserRole, IUser, IUserSafe, UserCrudResult, CRUDOperation, IUserDocument, IProject, IProjectSegmentationMask, projectModel, projectSegmentationMaskModel, createProject, readProject, updateProject, deleteProject, createProjectSegmentationMask, readProjectSegmentationMask, updateProjectSegmentationMask, deleteProjectSegmentationMask };