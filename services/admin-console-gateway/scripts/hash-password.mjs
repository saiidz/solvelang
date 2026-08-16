import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (typeof password !== "string" || password.length < 12 || password.length > 512) {
  console.error("Usage: node scripts/hash-password.mjs '<admin password at least 12 chars>'");
  process.exit(1);
}
const salt = randomBytes(32);
const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
process.stdout.write(`${salt.toString("hex")}:${derived.toString("hex")}\n`);
