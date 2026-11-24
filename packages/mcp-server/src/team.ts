// SolveLang Team Context Index — team records for the remote MCP tier.
//
// Pure addition to the remote surface: teams let an owner invite members
// BY ACCOUNT EMAIL; each accepted member receives their OWN team token
// and shares the TEAM's context index (the index document the team stores
// for its connected repo/workspace scope). A team token authenticates the
// exact same 10-tool read-only MCP surface as the single-user tokens and
// additionally reaches ONLY its own team's shared index through the team
// routes. It never reaches another team's index, and the single-user
// tokens never reach any team's index.
//
// Token discipline mirrors the rest of the remote server: plaintext team
// and invite tokens are returned exactly once (at team creation / invite
// creation / invite acceptance) and only their SHA-256 hashes are stored.
// Lookups hash the supplied token and compare hashes with
// timingSafeEqual. Revoking a member flips their record to "revoked" and
// their token stops authenticating immediately — the owner token and the
// single-user tokens are separate records and are unaffected.
//
// There are no price fields and no checkout wiring anywhere in this
// module: team context is an access record, not a billing surface.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const TEAM_TOKEN_PREFIX = "slteam_" as const;
export const TEAM_INVITE_PREFIX = "slinv_" as const;
export const MAX_TEAM_CONTEXT_INDEX_BYTES = 1024 * 1024;
export const TEAM_STORE_FILE_ENV = "SOLVELANG_REMOTE_TEAM_STORE_FILE" as const;
export const TEAM_STORE_MODE_ENV = "SOLVELANG_REMOTE_TEAMS" as const;

export type TeamErrorCode = "validation" | "unauthorized" | "forbidden" | "not_found" | "conflict";

export class TeamError extends Error {
  readonly code: TeamErrorCode;
  constructor(code: TeamErrorCode, message: string) {
    super(message);
    this.name = "TeamError";
    this.code = code;
  }
}

export type TeamMemberRole = "owner" | "member";
export type TeamMemberStatus = "active" | "revoked";
export type TeamInviteStatus = "pending" | "accepted" | "revoked";

export interface TeamMemberRecord {
  email: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  tokenHash: string;
  tokenPrefix: string;
  createdAt: string;
  revokedAt?: string;
}

export interface TeamInviteRecord {
  email: string;
  status: TeamInviteStatus;
  inviteHash: string;
  invitePrefix: string;
  createdAt: string;
  acceptedAt?: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: string;
  contextIndex: unknown;
  members: TeamMemberRecord[];
  invites: TeamInviteRecord[];
}

export interface TeamMemberView {
  email: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  tokenPrefix: string;
  createdAt: string;
  revokedAt?: string;
}

export interface TeamView {
  id: string;
  name: string;
  ownerEmail: string;
  createdAt: string;
  hasContextIndex: boolean;
}

export function teamView(team: TeamRecord): TeamView {
  return {
    id: team.id,
    name: team.name,
    ownerEmail: team.ownerEmail,
    createdAt: team.createdAt,
    hasContextIndex: team.contextIndex !== null && team.contextIndex !== undefined,
  };
}

export function memberView(member: TeamMemberRecord): TeamMemberView {
  return {
    email: member.email,
    role: member.role,
    status: member.status,
    tokenPrefix: member.tokenPrefix,
    createdAt: member.createdAt,
    ...(member.revokedAt ? { revokedAt: member.revokedAt } : {}),
  };
}

export function normalizeTeamEmail(value: unknown): string {
  if (typeof value !== "string") throw new TeamError("validation", "An account email is required.");
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) {
    throw new TeamError("validation", "A valid account email is required.");
  }
  return email;
}

export function normalizeTeamName(value: unknown): string {
  if (typeof value !== "string") throw new TeamError("validation", "A team name is required.");
  const name = value.trim();
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TeamError("validation", "A team name of 1-120 characters without control characters is required.");
  }
  return name;
}

export function validateTeamContextIndex(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TeamError("validation", "The team context index must be a JSON object.");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_TEAM_CONTEXT_INDEX_BYTES) {
    throw new TeamError("validation", `The team context index exceeds the ${MAX_TEAM_CONTEXT_INDEX_BYTES} byte safety limit.`);
  }
  return value;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashMatches(suppliedHash: string, storedHash: string): boolean {
  const supplied = Buffer.from(suppliedHash, "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  return supplied.length === stored.length && timingSafeEqual(supplied, stored);
}

function generateToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("hex")}`;
}

function tokenPrefix(token: string): string {
  return token.slice(0, 15);
}

interface TeamStoreData {
  teams: TeamRecord[];
}

export class TeamStore {
  private data: TeamStoreData = { teams: [] };
  private readonly filePath?: string;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(options: Readonly<{ filePath?: string }> = {}) {
    this.filePath = options.filePath;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch {
      this.data = { teams: [] };
      return;
    }
    const parsed = JSON.parse(text) as TeamStoreData;
    if (!parsed || !Array.isArray(parsed.teams)) throw new Error("Team store file is malformed.");
    this.data = parsed;
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const filePath = this.filePath;
    const snapshot = JSON.stringify(this.data, null, 2);
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp-${randomBytes(6).toString("hex")}`;
      await writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, filePath);
    });
    await this.saveChain;
  }

  private findTeam(teamId: string): TeamRecord {
    const team = this.data.teams.find((entry) => entry.id === teamId);
    if (!team) throw new TeamError("not_found", "Team not found.");
    return team;
  }

  async createTeam(input: Readonly<{ name: unknown; ownerEmail: unknown; contextIndex?: unknown }>): Promise<{ team: TeamRecord; ownerToken: string; owner: TeamMemberRecord }> {
    const name = normalizeTeamName(input.name);
    const ownerEmail = normalizeTeamEmail(input.ownerEmail);
    const contextIndex = validateTeamContextIndex(input.contextIndex);
    const ownerToken = generateToken(TEAM_TOKEN_PREFIX);
    const owner: TeamMemberRecord = {
      email: ownerEmail,
      role: "owner",
      status: "active",
      tokenHash: hashToken(ownerToken),
      tokenPrefix: tokenPrefix(ownerToken),
      createdAt: new Date().toISOString(),
    };
    const team: TeamRecord = {
      id: randomUUID(),
      name,
      ownerEmail,
      createdAt: owner.createdAt,
      contextIndex,
      members: [owner],
      invites: [],
    };
    this.data.teams.push(team);
    await this.persist();
    return { team, ownerToken, owner };
  }

  async getTeam(teamId: string): Promise<TeamRecord> {
    return this.findTeam(teamId);
  }

  async createInvite(teamId: string, emailInput: unknown): Promise<{ inviteToken: string; invite: TeamInviteRecord }> {
    const team = this.findTeam(teamId);
    const email = normalizeTeamEmail(emailInput);
    if (team.members.some((member) => member.email === email && member.status === "active")) {
      throw new TeamError("conflict", "That account email is already an active member of this team.");
    }
    if (team.invites.some((invite) => invite.email === email && invite.status === "pending")) {
      throw new TeamError("conflict", "That account email already has a pending invite to this team.");
    }
    const inviteToken = generateToken(TEAM_INVITE_PREFIX);
    const invite: TeamInviteRecord = {
      email,
      status: "pending",
      inviteHash: hashToken(inviteToken),
      invitePrefix: tokenPrefix(inviteToken),
      createdAt: new Date().toISOString(),
    };
    team.invites.push(invite);
    await this.persist();
    return { inviteToken, invite };
  }

  async acceptInvite(inviteTokenInput: unknown, emailInput: unknown): Promise<{ team: TeamRecord; memberToken: string; member: TeamMemberRecord }> {
    if (typeof inviteTokenInput !== "string" || !inviteTokenInput.startsWith(TEAM_INVITE_PREFIX)) {
      throw new TeamError("unauthorized", "Invite token is invalid.");
    }
    const email = normalizeTeamEmail(emailInput);
    const suppliedHash = hashToken(inviteTokenInput);
    for (const team of this.data.teams) {
      const invite = team.invites.find((entry) => entry.status === "pending" && hashMatches(suppliedHash, entry.inviteHash));
      if (!invite) continue;
      if (invite.email !== email) {
        throw new TeamError("forbidden", "This invite was issued to a different account email.");
      }
      const memberToken = generateToken(TEAM_TOKEN_PREFIX);
      const member: TeamMemberRecord = {
        email,
        role: "member",
        status: "active",
        tokenHash: hashToken(memberToken),
        tokenPrefix: tokenPrefix(memberToken),
        createdAt: new Date().toISOString(),
      };
      team.members.push(member);
      invite.status = "accepted";
      invite.acceptedAt = member.createdAt;
      await this.persist();
      return { team, memberToken, member };
    }
    throw new TeamError("unauthorized", "Invite token is invalid or no longer pending.");
  }

  async listMembers(teamId: string): Promise<TeamMemberRecord[]> {
    return this.findTeam(teamId).members;
  }

  async revokeMember(teamId: string, emailInput: unknown): Promise<TeamMemberRecord> {
    const team = this.findTeam(teamId);
    const email = normalizeTeamEmail(emailInput);
    const member = team.members.find((entry) => entry.email === email);
    if (!member) throw new TeamError("not_found", "That account email is not a member of this team.");
    if (member.role === "owner") throw new TeamError("forbidden", "The team owner cannot be revoked.");
    if (member.status === "revoked") throw new TeamError("conflict", "That member has already been revoked.");
    member.status = "revoked";
    member.revokedAt = new Date().toISOString();
    await this.persist();
    return member;
  }

  async setContextIndex(teamId: string, contextIndexInput: unknown): Promise<TeamRecord> {
    const team = this.findTeam(teamId);
    team.contextIndex = validateTeamContextIndex(contextIndexInput);
    await this.persist();
    return team;
  }

  // Authenticate a team token. Only ACTIVE members match; a revoked
  // member's token hash remains on the record (audit) but never matches.
  async authenticate(token: string | undefined): Promise<{ team: TeamRecord; member: TeamMemberRecord } | undefined> {
    if (typeof token !== "string" || !token.startsWith(TEAM_TOKEN_PREFIX)) return undefined;
    const suppliedHash = hashToken(token);
    for (const team of this.data.teams) {
      for (const member of team.members) {
        if (member.status === "active" && hashMatches(suppliedHash, member.tokenHash)) {
          return { team, member };
        }
      }
    }
    return undefined;
  }
}

// Build the store from the environment. Returns undefined when teams are
// not configured at all — the HTTP layer fails closed (503) on every team
// route in that case, and /mcp keeps its exact single-user behavior.
//   SOLVELANG_REMOTE_TEAM_STORE_FILE=/path/teams.json  durable file store
//   SOLVELANG_REMOTE_TEAMS=memory                      in-memory (tests/dev)
export async function teamStoreFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TeamStore | undefined> {
  const filePath = env[TEAM_STORE_FILE_ENV]?.trim();
  if (filePath) {
    const store = new TeamStore({ filePath });
    await store.load();
    return store;
  }
  if (env[TEAM_STORE_MODE_ENV]?.trim().toLowerCase() === "memory") {
    return new TeamStore();
  }
  return undefined;
}
