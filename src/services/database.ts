// Description: Database Service for the VisHeart Server
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../../.env") });

const dbname: string = "visheart";
const dburl: string = process.env.MONGODB_URI || "mongodb://localhost:27017/visheart";

// Connect to MongoDB
const connectToDatabase = async () => {
    try {
        await mongoose.connect(dburl, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("Connected to MongoDB database:", dbname);
    }
    catch (error) {
        console.error("Error connecting to MongoDB:", error);
    }
}
