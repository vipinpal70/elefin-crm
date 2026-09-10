const path = require("path");

// Load repo-root .env so the CLI shares the app's connection string.
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

/** @type {import('migrate-mongo').config.Config} */
module.exports = {
  mongodb: {
    url: process.env.MONGODB_URI || "mongodb://localhost:27017",
    databaseName: process.env.MONGODB_DB || "elefin_crm",
    options: {},
  },
  migrationsDir: "migrations",
  changelogCollectionName: "migrations_changelog",
  migrationFileExtension: ".cjs",
  useFileHash: false,
  moduleSystem: "commonjs",
};
