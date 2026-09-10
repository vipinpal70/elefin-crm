/**
 * Phase 1 - seed the DB from docs/elefin_clients.xlsx so trend/analytics work
 * has a starting baseline without needing live API credentials.
 *
 *   npm run import:xlsx
 *
 * TODO (Phase 1):
 *   - read the "Elefin Clients" sheet (headers match the /clients export)
 *   - map each row -> Client upsert (Decimal128 for money, split accounts_logins)
 *   - create one accounts doc per login with the balances present
 *   - write a client_daily + book_daily snapshot dated to the file's export day
 *     (2026-08-31) so charts have an origin point
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const XLSX_PATH = path.resolve(import.meta.dirname, "../docs/elefin_clients.xlsx");

console.log(
  `import-xlsx is a Phase 1 stub. Target file: ${XLSX_PATH}\n` +
    "Implement the mapping described in this file's header comment.",
);
