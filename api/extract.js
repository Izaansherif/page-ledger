import { handler } from "../netlify/functions/extract.js";
import { wrap } from "./_adapt.js";

export default wrap(handler);
