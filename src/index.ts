import express, { Request, Response } from "express";
import dotenv from "dotenv";

const logger = require("./services/logger");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
    res.send("Hello, TypeScript Server!");
});

app.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
});