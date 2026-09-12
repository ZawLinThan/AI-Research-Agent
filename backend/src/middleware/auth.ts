import { authSessions } from "../auth/index.js";
import { sessionUser } from "../auth/routes.js";

export const requireUser = sessionUser(authSessions);
