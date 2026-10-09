import { Router } from "express";
import {
  createResearch,
  approvePlan,
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
router.post("/:projectId/approve", approvePlan);
export default router;
