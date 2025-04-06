// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose, { Schema, Document, model, Model } from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import * as bcrypt from "bcrypt";

// Import utility functions
import LogError from "../utils/error_logger"; // Import the error logging utility
const serviceLocation = "Database"; // Service location for error logging

// TODO: File check script to check if the file exists and is readable before loading it
// TODO: Read and Delete User and CRUD Files functions

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });
} catch (error: unknown) {
  LogError(error as Error, serviceLocation, "Error loading .env file.");
};

// Database connection URL and name
const DB_NAME = "visheart";
const DB_URI: string =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

// Fetch default admin password
const adminPass: string = process.env.ADMIN_PASS || "admin"; // Default to "admin" if not set

// Connect to MongoDB (called in index.ts)
const connectToDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(DB_URI);
    logger.info(`Database: Connected to MongoDB database: ${DB_NAME} at ${DB_URI}`);
    await createAdminUser();
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error connecting to MongoDB database: ${DB_NAME} at ${DB_URI}`)
  }
};

/* Interfaces */
// Enumeration for user roles
/**
 * UserRole enum defines the different roles a user can have in the system.
 * - User: Regular user with standard permissions.
 * - Admin: User with elevated permissions for administrative tasks.
 */
enum UserRole {
  User = "user",
  Admin = "admin",
}
// User Interface (anyone that is treated as a user must have these properties)
/**
 * IUser interface defines the structure of a user object in the system.
 * It includes properties for:
 * {string} username - The unique username of the user.
 * {string} password - The hashed password of the user.
 * {string} email - The email address of the user.
 * {string} phone - The phone number of the user.
 * {UserRole} role - The role of the user, which can be either "user" or "admin".
 */
interface IUser {
  username: string;
  password: string;
  email: string;
  phone: string;
  role: UserRole; // Default to "user" unless specified otherwise
}
// User Interface Safe - sanitized version for public use (e.g., API responses)
interface IUserSafe {
  username: string;
  email: string;
  phone: string;
  role: UserRole; // Default to "user" unless specified otherwise
}
// User Model Interface (single user document in the database)
interface IUserDocument extends IUser, Document { }
// Convert IUserDocument to IUserSafe for public use
function toIUserSafe(user: IUserDocument): IUserSafe {
  return {
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

// File Interface - Defines a saved file record in the database
interface IFile {
  filename: string;
  filepath: string; // Could be local or S3 path
  filetype: string; // MIME type of the file (e.g., image/nifti, image/dicom, etc.)
  filehash: string;
  filesize: number; // In bytes (helps enforce file size limits)
  createdAt: Date;
  createdBy: string; // Reference to the user who uploaded the file
  description: string;
}
// File Model Interface (single file document in the database)
interface IFileDocument extends IFile, Document { }

/* Collection Creation */
// User Collection
const userSchema = new Schema<IUserDocument>({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, enum: Object.values(UserRole), default: UserRole.User },
});
// Create the model with proper typing
const userModel = model<IUserDocument, Model<IUserDocument>>("User", userSchema);

// Create a default admin user if it doesn't exist
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
      if (createdAdmin) {
        logger.warn(
          `Database: WARNING: Default admin account created successfully with ID:${createdAdmin._id}. Please change the password IMMEDIATELY.`
        );
      }
    } else {
      logger.info(`Database: Admin account(s) already exists.`);
      return;
    }
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, "Error checking or creating admin account.");
  }
};

// File Collection
const fileSchema = new Schema<IFileDocument>({
  filename: { type: String, required: true },
  filepath: { type: String, required: true },
  filetype: { type: String, required: true },
  filehash: { type: String, required: true },
  filesize: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, required: true },
  description: { type: String, required: false },
});
// Create the model with proper typing
const fileModel = model<IFileDocument, Model<IFileDocument>>("File", fileSchema);

/* Database Functions */
enum CRUDOperation {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
}

// User Functions
// Define result type for user CRUD operations
interface UserCrudResult {
  success: boolean; // Indicates whether the operation was successful 
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  user?: IUserSafe; // The created or updated user document (applicable for CREATE and UPDATE operations)
  users?: IUserSafe[]; // Array of user documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

// Function to create a new user given a username, password, email, and phone number
/**
 * @param username {string} - The username of the user to create
 * @param password {string} - The password of the user to create
 * @param email {string} - The email of the user to create
 * @param phone {string} - The phone number of the user to create
 * @param role {UserRole} (Optional) The role of the user. Defaults to UserRole.User. Can also be UserRole.Admin.
 * @returns {UserCrudResult} - A promise that resolves to an object indicating success or failure.
 * If successful, it returns the created user document.
 * If the user already exists, it returns an error message.
 * If the user does not exist, it returns an error message.
 * If the user is created successfully, it returns the created user document.
 */
const createUser = async (
  username: string,
  password: string,
  email: string,
  phone: string,
  role: UserRole = UserRole.User, // Default role is "user" unless specified otherwise
  // Default role is "user" unless specified otherwise
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


// Function to read user or users based on property of IUser
/**
 * Searches/Finds/Reads for users in the database. If no criteria is provided, it returns all users.
 * @param username {string} - The username of the user to read (optional)
 * @param email {string} - The email of the user to read (optional)
 * @param phone {string} - The phone number of the user to read (optional)
 * @param role {UserRole} - The role of the user to read (optional)
 * @returns {UserCrudResult} - A promise that resolves to an object indicating success or failure.
 * If no user is found, it returns an error message.
 * If the user(s) is found successfully, it returns the found user(s) document(s).
 * If no criteria is provided, it returns all users.
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


// Function to update a user, given a user ID and an object with the new data
/**
 * Updates a user in the database with the provided username and updates object.
 * @param username - The username of the user to update
 * @param updates - An object containing the fields to update. At least one field must be provided:
 * @param updates.username - The new username of the user (optional).
 * @param updates.password - The new password of the user (optional).
 * @param updates.email - The new email of the user (optional).
 * @param updates.phone - The new phone number of the user (optional).
 * @param updates.role - The new role of the user (optional).
 * @returns {UserCrudResult} - A promise that resolves to an object indicating success or failure. 
 * If successful, it returns the updated user document.
 * If any field conflicts with existing users, it returns an error message.
 */
const updateUser = async (
  username: string,
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
      if (updates.email === existingUser.username) {
        unchangedFields.push("username");
      } else {
        // Check if the username is already in use by another user
        const usernameExists = await userModel.findOne({
          username: updates.username,
          _id: { $ne: existingUser._id }, // Exclude current user
        });

        if (usernameExists) {
          return { success: false, operation: CRUDOperation.UPDATE, message: `Username "${updates.username}" is already in use by another user.`, };
        }
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
          username: { $ne: username }, // Exclude current user
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
          username: { $ne: username }, // Exclude current user
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
      logger.warn(
        `Database: No fields to update for user ${username}. Unchanged fields: ${unchangedFields.join(
          ", "
        )}`
      );
      return { success: false, operation: CRUDOperation.UPDATE, message: `No fields to update for user ${username}.`, };
    }

    // Perform the update
    const updatedUser = existingUser.set(updateData);
    await updatedUser.save();
    logger.info(
      `Database: User ${username} updated successfully. Updated fields: ${Object.keys(
        updateData
      ).join(", ")}`
    );
    return { success: true, operation: CRUDOperation.UPDATE, user: toIUserSafe(updatedUser) };
  } catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error updating user ${username}.`);
    return { success: false, operation: CRUDOperation.UPDATE, message: "Error updating user." };
  }
};

// Should return a success message if the user is deleted successfully with UserCrudResult [2]
// const deleteUser = async (username: string): Promise<UserCrudResult> => {

// };

// File Functions
// Define result type for createFile function
type FileCrudResult =
  | { success: true; file: IFileDocument } // Successful file creation
  | { success: false; error: string }; // File already exists or other error

// Function to create a new file record in the database
const createFile = async (
  filename: string,
  filepath: string,
  filetype: string,
  filehash: string,
  filesize: number, // In bytes
  createdBy: string,
  description: string | undefined = undefined
): Promise<FileCrudResult> => {
  try {
    // Check if file exists with name, hash
    const existingFile = await fileModel.findOne({
      $or: [{ filename: filename }, { filehash: filehash }],
    });
    if (existingFile) {
      let reasons = `File already exists: `;
      if (existingFile.filename === filename) {
        reasons += `Filename "${filename}" already exists. `;
      }
      if (existingFile.filehash === filehash) {
        reasons += `File hash "${filehash}" already exists. `;
      }
      logger.warn(`Database: Error creating file: ${reasons}`);
      return { success: false, error: reasons };
    }
    // Create a new file instance
    const newFile: IFileDocument = new fileModel({
      filename: filename,
      filepath: filepath,
      filetype: filetype,
      filehash: filehash,
      filesize: filesize,
      createdBy: createdBy,
      description: description,
    });
    // Save the new file to the database
    await newFile.save();
    logger.info(
      `Database: File ${newFile._id} created successfully: ${newFile.filename}, ${newFile.filepath}, ${newFile.filetype}`
    );
    return { success: true, file: newFile };
  }
  catch (error: unknown) {
    LogError(error as Error, serviceLocation, `Error creating file ${filename}.`);
    return { success: false, error: "Error creating file." };
  }
};

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
export { connectToDatabase, userModel, fileModel, createUser, readUser, updateUser, createFile, UserRole };