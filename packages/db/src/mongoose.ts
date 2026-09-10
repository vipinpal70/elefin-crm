/**
 * Mongoose is CommonJS; some of its properties (notably `models`) are not
 * statically detectable as named ESM exports. Import runtime values from here
 * instead of directly from "mongoose". Type-only imports from "mongoose" are
 * fine anywhere (they are erased).
 */
import mongoose from "mongoose";

export const { Schema, model, models, Types } = mongoose;
export { mongoose };
export default mongoose;
