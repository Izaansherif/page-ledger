import { handler } from "../netlify/functions/config.js";
import { wrap } from "./_adapt.js";

export default wrap(handler);
