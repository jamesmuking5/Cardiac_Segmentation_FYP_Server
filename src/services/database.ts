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
import { IUser, IUserDocument, IUserSafe, UserRole, CRUDOperation, UserCrudResult, IProjectDocument } from "../types/database_types"; // Import the user types
import { FileType, FileDataType, ComponentBoundingBoxesClass, IProject, IProjectSegmentationMask, ProjectCrudResult } from "../types/database_types"; // Import the project types

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

/* User Collection Creation */
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
    LogError(error as Error, serviceLocation, `Error reading user with ID: ${id}.`);
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
    await existingUser.deleteOne();
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

/*==================================================================================================== Project Section begins here ===================================================================================================================*/

/* Project Collection Creation */
// Create status schema for use in project schema (Nest Depth: 1)
const projectStatusSchema = new Schema({
  upload: { type: Boolean, default: false, required: true }, // Indicates if the file has been uploaded
  extract: { type: Boolean, default: false, required: true }, // Indicates if the file has been extracted
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

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
  // Processing status
  status: { type: projectStatusSchema, required: true, default: {} }, // Status of the project processing, default: {} tells mongoose to use the default values defined in the statusSchema
  // File specifics
  datatype: { type: String, required: true }, // Data type of the image (e.g., uint8, float32)
  dimensions: { type: projectDimensionSchema, required: true }, // Dimensions of the image (e.g., width, height, slices, frames)
  // Voxel size (future proofing for 3D segmentation)
  voxelsize: { type: projectVoxelsizeSchema, required: false }, // Voxel size of the image (e.g., x, y, z, t dimensions) - check for errors in the future (stored in nifti as pixdim = [?, 0.5, 0.5, 1.0, 2.0, 0, 0, 0])
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
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

// Create Segmentation Mask Location Schema (Nest Depth: 3)
const projectSegmentationMasksSliceSegmentationMasksLocationSchema = new Schema({
  path: { type: String, required: true }, // Path to the segmentation mask image (e.g., S3 bucket URL)
  isRLE: { type: Boolean, required: true }, // Indicates if the segmentation mask is in RLE format
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create slice schema (Nest Depth: 2)
const projectSegmentationMaskSliceSchema = new Schema({
  sliceindex: { type: Number, required: true }, // Index of the slice (0-based)
  slicepath: { type: String, required: true }, // Path to the slice image (e.g., S3 bucket URL)
  componentboundingboxes: [{ type: projectSegmentationMaskSliceComponentBoundingBoxesSchema, required: false }], // Array of component bounding boxes for the slice
  segmentationmaskslocation: [{ type: projectSegmentationMasksSliceSegmentationMasksLocationSchema, required: false }], // Path to the segmentation mask image (e.g., S3 bucket URL) - assume CSV? or RLE?
}, { _id: false }); // Disable automatic creation of an _id field for this subdocument

// Create frames schema (Nest Depth: 1)
const projectSegmentationMaskFramesSchema = new Schema({
  frameIndex: { type: Number, required: true }, // Index of the frame (0-based)
  frameInferred: { type: Boolean, required: true, default: false }, // Indicates if the frame is inferred (update if user runs MedSAM on the frame)
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
  isMedSAMOutput: { type: Boolean, required: true, default: false }, // Indicates if the segmentation mask is a MedSAM output
  // Properties of extracted folder + location tracking
  // Index should be 0 based
  frames: [{ type: projectSegmentationMaskFramesSchema, required: true }], // Array of frames for the segmentation mask
}, { timestamps: true }); // Automatically add createdAt and updatedAt timestamps
// Create the model with proper typing
const projectSegmentationMaskModel = model<IProjectSegmentationMask, Model<IProjectSegmentationMask>>("Segmentation Masks", projectSegmentationMaskSchema);

// Add an index to improve query performance
projectSchema.index({ userid: 1, name: 1 }, { unique: true }); // Unique index on userid and name
projectSegmentationMaskSchema.index({ projectid: 1 });

/* ========================================= MongoDB Hooks ========================================== */

// Add validation to ensure userid exists before saving the project
projectSchema.pre('save', async function (next) {
  const userExists = await userModel.exists({ _id: this.userid });
  if (!userExists) {
    throw new Error('Referenced user does not exist');
  }
  next();
});

// Add validation to ensure projectid exists before saving
projectSegmentationMaskSchema.pre('save', async function (next) {
  const projectExists = await projectModel.exists({ _id: this.projectid });
  if (!projectExists) {
    throw new Error('Referenced project does not exist');
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
  status: { upload: boolean; extract: boolean }, // Status of the project processing (upload and extract) - default to false
  datatype: FileDataType, // Data type of the image (e.g., uint8, float32) - should be detected by server
  dimensions: { width: number; height: number; slices: number; frames?: number },
  voxelsize?: { x: number; y: number; z?: number; t?: number }, // Optional physical voxel dimensions (e.g., x, y, z, t dimensions) - should be detected by server
  description?: string, // User-given description of the project (optional)
): Promise<ProjectCrudResult> => {
  const operation = CRUDOperation.CREATE;
  try {
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

    // If user does not exist, return error
    const user = await userModel.findById(userid);
    if (!user) {
      logger.warn(`Database: User ${userid} does not exist.`);
      return { success: false, operation, message: `User ${userid} does not exist.` };
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
      status: status,
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


// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
// ONLY unit tests should use userModel, fileModel directly, otherwise use the created functions to create users/files.
export { connectToDatabase, userModel, createUser, readUser, updateUser, deleteUser, authenticateUser, UserRole, IUserSafe, UserCrudResult, CRUDOperation, IUserDocument, IProject, IProjectSegmentationMask, projectModel, projectSegmentationMaskModel, createProject };
// createFile, readFile, updateFile,