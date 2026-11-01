import { handler } from "../netlify/functions/transcribe.js";
import { wrap } from "./_adapt.js";

export default wrap(handler);
