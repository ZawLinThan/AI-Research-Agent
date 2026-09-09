import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import researchRouter from "./routes/research.route.js";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

app.use("/api/research", researchRouter);

app.get("/", async (req, res) => {
  res.send("Backend running!!");
});

app.listen(PORT, () => {
  console.log("Server is running on http://localhost:3000");
});
