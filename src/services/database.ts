// Description: Database Service for the VisHeart Server
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../../.env") });

const dbname: string = "visheart";
const dburl: string = process.env.MONGODB_URI || "mongodb://localhost:27017/visheart";

// Connect to MongoDB