// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose, { Schema, Document, model, Model } from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import * as bcrypt from "bcrypt";

// Load environment variables from .env file
try {
  // override: true allows to override cached environment variables
  dotenv.config({ path: path.join(__dirname, "../../.env"), override: true });
} catch (error: unknown) {
  if (error instanceof Error) { logger.error(`Database: Unable to load environment variables. Error: ${error.message}`); }
  else { logger.error(`Database: Unknown error loading environment variables: ${error}`); }
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
    if (error instanceof Error) { logger.error(`Database: Unable to connect to MongoDB database. Error: ${error.message}`); }
    else { logger.error(`Database: Unknown error connecting to the database: ${error}`); }
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
// Mongoose Model Interface - Defines static methods (the schema model)
interface IUserModel extends Model<IUserDocument> { }

// File Interface - Defines a saved file record in the database
interface IFile {
  filename: string;
  filepath: string; // Could be local or S3 path
  filetype: string; // MIME type of the file (e.g., image/nifti, image/dicom, etc.)
  filehash: string;
  filesize: number;  // In bytes (helps enforce file size limits)
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
const userSchema = new mongoose.Schema<IUserDocument>({
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
          `Database: WARNING: Default admin account created successfully. Please change the password IMMEDIATELY.`
        );
      }
    } else {
      logger.info(`Database: Admin account(s) already exists.`);
      return;
    }
  } catch (error: unknown) {
    if (error instanceof Error) { logger.error(`Database: Error checking or creating admin user: ${error.message}`); }
    else { logger.error(`Database: Unknown error checking or creating admin user: ${error}`); }
  }
};

// File Collection
const fileSchema = new mongoose.Schema<IFileDocument>({
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
type UserCreationResult =
  | { success: true, user: IUserDocument } // Successful user creation
  | { success: false, error: string } // User already exists or other error
// Function to create a new user given a username, password, email, and phone number
const createUser = async (
  username: string,
  password: string,
  email: string,
  phone: string,
  role: string = "user" // Default role is "user" unless specified otherwise
): Promise<UserCreationResult> => {
  try {
    // Use a single query with $or to check all unique constraints
    const existingUser = await userModel.findOne({
      $or: [
        { username: username },
        { email: email },
        { phone: phone }
      ]
    });
    if (existingUser) {
      let reasons: string = `User already exists: `;
      if (existingUser.username === username) { reasons += `Username "${username}" already exists. `; }
      if (existingUser.email === email) { reasons += `Email "${email}" already exists. `; }
      if (existingUser.phone === phone) { reasons += `Phone "${phone}" already exists. `; }
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
    logger.info(`Database: User created successfully: ${username}, ${email}, ${phone}`);
    return { success: true, user: newUser };
  } catch (error: unknown) {
    if (error instanceof Error) { logger.error(`Database: Error creating user: ${error.message}`); return { success: false, error: error.message }; }
    else { logger.error(`Database: Unknown error creating user: ${error}`); return { success: false, error: "Unknown error" }; }
  }
}

// Using ES modules instead of CommonJS which is module.exports = {connectToDatabase, User};
export { connectToDatabase, userModel, fileModel };
