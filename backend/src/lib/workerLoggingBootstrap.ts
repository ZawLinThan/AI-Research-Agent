import { workerLogging } from "./workerLogging.js";

// Install before worker dependencies are evaluated to include startup diagnostics.
workerLogging.install();
