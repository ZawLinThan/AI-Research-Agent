import { Router } from "express";
import {
  createResearch,
  getResearchStatus,
} from "../controllers/research.controller.js";

const router = Router();

router.get("/", (req, res) => {
  res.send("Research route is working!");
});

router.post("/", createResearch);
router.get("/:projectId", getResearchStatus);

export default router;
