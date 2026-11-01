import { handler } from "../netlify/functions/ask.js";
import { wrap } from "./_adapt.js";

export default wrap(handler);
