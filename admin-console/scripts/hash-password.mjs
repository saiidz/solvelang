import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (typeof password !== "string" || password.length < 12 || password.length > 512) {
  console.error("Usage: npm run hash-password -- '<password-at-least-12-chars>'");
  process.exit(1);
}
const salt = randomBytes(24);
const key = scryptSync(password, salt, 64);
process.stdout.write(`${salt.toString("hex")}:${key.toString("hex")}\n`);
