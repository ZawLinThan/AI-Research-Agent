import { Router } from "express";
import {
  createResearch,
  getResearchStatus,
  listResearchProjects,
  cancelResearchProject,
} from "../controllers/research.controller.js";
import { requireUser } from "../middleware/auth.js";
const router = Router();
router.use(requireUser);
router.get("/", listResearchProjects);
router.post("/", createResearch);
router.get("/:projectId", getResearchStatus);
router.post("/:projectId/cancel", cancelResearchProject);
export default router;
