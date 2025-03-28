// File: src/services/database.ts
// Description: Database Service for the VisHeart Server
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");
import logger from "./logger";

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
    logger.info(`Connected to MongoDB database: ${dbname} at ${dburl}`);
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error}`);
  }
};

module.exports = { connectToDatabase };
