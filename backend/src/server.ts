import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

app.get("/", async (req, res) => {
  res.send("Backend running!!");
});

app.listen(PORT, () => {
  console.log("Server is running on http://localhost:3000");
});