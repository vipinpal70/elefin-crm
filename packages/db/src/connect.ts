import mongoose from "mongoose";

/**
 * Memoised Mongoose connection.
 *
 * Next.js hot-reloads server modules in dev and runs many serverless invocations
 * in prod; without caching on `globalThis` we would open a new pool every time.
 * The worker is a single long-lived process, so it just gets the same cache.
 *
 * Only import this from server code (route handlers, server components, the
 * worker, scripts). Never from a client component or Edge middleware.
 */

interface Cached {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as unknown as {
  __elefinMongoose?: Cached;
};

const cached: Cached =
  globalForMongoose.__elefinMongoose ??
  (globalForMongoose.__elefinMongoose = { conn: null, promise: null });

export async function connect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and fill it in.",
    );
  }

  if (!cached.promise) {
    mongoose.set("strictQuery", true);
    // Dev builds indexes automatically; prod relies on `npm run db:migrate`.
    mongoose.set("autoIndex", process.env.NODE_ENV !== "production");
    cached.promise = mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB || undefined,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

export async function disconnect(): Promise<void> {
  if (cached.conn) {
    await cached.conn.disconnect();
    cached.conn = null;
    cached.promise = null;
  }
}

export { mongoose };
