// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose, { Schema, Document, model, Model } from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import * as bcrypt from "bcrypt";

// TODO: File check script to check if the file exists and is readable before loading it
// TODO:

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });
} catch (error: unknown) {
  if (error instanceof Error) {
    logger.error(
      `Database: Unable to load environment variables. Error: ${error.message}`
    );
  } else {
    logger.error(
      `Database: Unknown error loading environment variables: ${error}`
    );
  }
}

// Database connection URL and name
const dbname: string = "visheart";
const dburl: string =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

// Fetch default admin password
const adminPass: string = process.env.ADMIN_PASS || "admin"; // Default to "admin" if not set

// Connect to MongoDB
const connectToDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(dburl);
    logger.info(
      `Database: Connected to MongoDB database: ${dbname} at ${dburl}`
    );
    await createAdminUser();
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error(
        `Database: Unable to connect to MongoDB database. Error: ${error.message}`
      );
    } else {
      logger.error(
        `Database: Unknown error connecting to the database: ${error}`
      );
    }
  }
};

// User Interface (anyone that is treated as a user must have these properties)
interface IUser {
  username: string;
  password: string;
  email: string;
  phone: string;
  role: string;
}
// User Model Interface (single user document in the database)
interface IUserDocument extends IUser, Document { }
// Mongoose Model Interface - Defines static methods (the schema model) - Model<IUserDocument> means Model's (from mongoose) datatype is IUserDocument
interface IUserModel extends Model<IUserDocument> { }

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
// Mongoose Model Interface - Defines static methods (the schema model)
interface IFileModel extends Model<IFileDocument> { }

/* Collection Creation */
// User Collection
const userSchema = new Schema<IUserDocument>({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, default: "user" },
});
// Create the model with proper typing
const userModel = model<IUserDocument, IUserModel>("User", userSchema);

// Create a default admin user if it doesn't exist
const createAdminUser = async () => {
  // Check if an admin user exists
  // Cannot use IUserDocument ONLY here because it may return null if no admins exist.
  // If it returns a user, TypeScript auto casts it to IUserDocument because of const User = model<IUserDocument, IUserModel>("User", userSchema);.
  // The default is IUserDocument | null but can just let auto infer the type.
  const existingAdmin = await userModel.findOne({ role: "admin" });
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
        role: "admin",
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
    if (error instanceof Error) {
      logger.error(
        `Database: Error checking or creating admin user: ${error.message}`
      );
    } else {
      logger.error(
        `Database: Unknown error checking or creating admin user: ${error}`
      );
    }
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
const fileModel = model<IFileDocument, IFileModel>("File", fileSchema);

/* Database Functions */
// User Functions
// Define result type for createUser function
type UserCrudResult =
  | { success: true; user: IUserDocument } // Successful user creation
  | { success: false; error: string }; // User already exists or other error

// Function to create a new user given a username, password, email, and phone number
const createUser = async (
  username: string,
  password: string,
  email: string,
  phone: string,
  role: string = "user" // Default role is "user" unless specified otherwise
): Promise<UserCrudResult> => {
  try {
    // Use a single query with $or to check all unique constraints
    const existingUser = await userModel.findOne({
      $or: [{ username: username }, { email: email }, { phone: phone }],
    });
    if (existingUser) {
      let reasons: string = `User already exists: `;
      if (existingUser.username === username) {
        reasons += `Username "${username}" already exists. `;
      }
      if (existingUser.email === email) {
        reasons += `Email "${email}" already exists. `;
      }
      if (existingUser.phone === phone) {
        reasons += `Phone "${phone}" already exists. `;
      }
      logger.warn(`Database: Error creating user: ${reasons}`);
      return { success: false, error: reasons };
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
    logger.info(
      `Database: User ${newUser._id} created successfully: ${newUser.username}, ${newUser.email}, ${newUser.phone}`
    );
    return { success: true, user: newUser };
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error(`Database: Error creating user: ${error.message}`);
      return { success: false, error: error.message };
    } else {
      logger.error(`Database: Unknown error creating user: ${error}`);
      return { success: false, error: "Unknown error" };
    }
  }
};

// Function to update a user, given a user ID and an object with the new data
const updateUser = async (
  username: string,
  updates: {
    username?: string;
    password?: string;
    email?: string;
    phone?: string;
    role?: string;
  }
): Promise<UserCrudResult> => {
  try {
    // Check if the user exists
    const existingUser = await userModel.findOne({ username: username });
    if (!existingUser) {
      logger.warn(`Database: User ${username} does not exist.`);
      return { success: false, error: `User ${username} does not exist.` };
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
          return {
            success: false,
            error: `Username "${updates.username}" is already in use by another user.`,
          };
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
          return {
            success: false,
            error: `Email "${updates.email}" is already in use by another user.`,
          };
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
          return {
            success: false,
            error: `Phone "${updates.phone}" is already in use by another user.`,
          };
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
      return {
        success: false,
        error: `No fields to update for user ${username}.`,
      };
    }

    // Perform the update
    const updatedUser = existingUser.set(updateData);
    await updatedUser.save();
    logger.info(
      `Database: User ${username} updated successfully. Updated fields: ${Object.keys(
        updateData
      ).join(", ")}`
    );
    return { success: true, user: updatedUser };
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error(`Database: Error updating user: ${error.message}`);
      return { success: false, error: error.message };
    } else {
      logger.error(`Database: Unknown error updating user: ${error}`);
      return { success: false, error: "Unknown error" };
    }
  }
};

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
export { connectToDatabase, userModel, fileModel, createUser, updateUser };
