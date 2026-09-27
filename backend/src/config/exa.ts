import Exa from "exa-js";
import { PermanentError } from "../lib/errors";

if (!process.env.EXA_API_KEY) {
  throw new PermanentError("EXA_API_KEY is not set in the environment.");
}

export const exaClient = new Exa(process.env.EXA_API_KEY);
