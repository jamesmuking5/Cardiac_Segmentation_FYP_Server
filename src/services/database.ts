// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
import mongoose from "mongoose";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import bcrypt from "bcrypt";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const dbname: string = "visheart";
const dburl: string =
  process.env.MONGODB_URI || "mongodb://localhost:27017/visheart";

// Connect to MongoDB
const connectToDatabase = async () => {
  try {
    await mongoose.connect(dburl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info(
      `Database: Connected to MongoDB database: ${dbname} at ${dburl}`
    );
  } catch (error) {
    logger.error(`Database: Error connecting to MongoDB: ${error}`);
  }
};

/* Collection Creation */
// User Collection
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  role: { type: String, required: true, default: "user" },
});
const User = mongoose.model("User", userSchema);

// Create a default admin user if it doesn't exist
interface createAdminUser {
  username: string;
  password: string;
  email: string;
  phone: string;
  role: string;
}

const createAdminUser = async () => {
  try {
    // Check if an admin user exists
    const existingAdmin = await User.findOne({ role: "admin" });
    try {
      if (!existingAdmin) {
        logger.info(
          `Database: No admin account found. Creating default admin account.`
        );
        // Create an admin user with username "admin" and password "admin" (Emergency creation of admin account in case of no admin account)
        const hashedPassword = bcrypt.hash("admin", 10);
        const admin = new User({
          username: "admin",
          password: hashedPassword,
          email: "admin@example.com",
          phone: "1234567890",
          role: "admin",
        });
        // Save the admin user to the database
        await admin.save();
        // Check if the admin user was created successfully
        const createdAdmin = await User.findOne({ username: "admin" });
        if (createdAdmin) {
          logger.info(
            `Database: Default admin account created successfully. Please change the password immediately.`
          );
        }
      } else {
        logger.info(`Database: Admin account(s) already exists.`);
        return;
      }
    } catch (error) {
      logger.error(`Database: Error creating default admin account: ${error}`);
    }
  } catch (error) {
    logger.error(`Database: Error : ${error}`);
  }
};

module.exports = { connectToDatabase };
