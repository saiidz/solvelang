import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

// One DynamoDB table, one string partition key (recordKey), three record
// kinds:
//   installation#<id>            the installation as last reported by a
//                                signed GitHub webhook (source of truth
//                                for repos + suspension), plus the
//                                SolveLang accountId once linked.
//   state#<nonce>                a single-use OAuth state nonce with an
//                                expiresAt TTL (epoch seconds).
//   link#<accountId>#<instId>    the account <-> installation link; the
//                                account listing is a begins_with Query
//                                on this prefix, then one Get per id.
// Records are only ever written from a validly signed webhook or from an
// authenticated account action — never from unauthenticated input.

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function installationKey(installationId) {
  return `installation#${installationId}`;
}

function stateKey(nonce) {
  return `state#${nonce}`;
}

function linkKey(accountId, installationId) {
  return `link#${accountId}#${installationId}`;
}

function linkPrefix(accountId) {
  return `link#${accountId}#`;
}

function requiredId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is required.`);
  return value;
}

function publicInstallation(item) {
  if (!item || item.kind !== "installation") return undefined;
  return {
    installationId: item.installationId,
    accountLogin: typeof item.accountLogin === "string" ? item.accountLogin : "",
    accountType: typeof item.accountType === "string" ? item.accountType : "",
    repositories: Array.isArray(item.repositories) ? item.repositories : [],
    suspended: item.suspended === true,
    ...(typeof item.accountId === "string" && item.accountId ? { accountId: item.accountId } : {}),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
  };
}

export function createDynamoGitHubStore(documentClient, tableName, { now = Date.now } = {}) {
  if (!documentClient?.send || typeof tableName !== "string" || !tableName) throw new Error("GitHub store is required.");
  const nowSeconds = () => Math.floor((typeof now === "function" ? now() : now) / 1_000);

  return {
    async putInstallation(record) {
      const installationId = requiredId(record?.installationId, "GitHub installation id");
      // A webhook rewrite must never drop an account link stamped earlier:
      // when the incoming record carries no accountId, keep the stored one.
      let accountId = typeof record.accountId === "string" && record.accountId ? record.accountId : undefined;
      if (!accountId) {
        const existing = await this.getInstallation(installationId);
        accountId = existing?.accountId;
      }
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          recordKey: installationKey(installationId),
          kind: "installation",
          installationId,
          accountLogin: typeof record.accountLogin === "string" ? record.accountLogin : "",
          accountType: typeof record.accountType === "string" ? record.accountType : "",
          repositories: Array.isArray(record.repositories) ? record.repositories : [],
          suspended: record.suspended === true,
          ...(accountId ? { accountId } : {}),
          updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : new Date(nowSeconds() * 1_000).toISOString(),
        },
      }));
    },

    async getInstallation(installationId) {
      requiredId(installationId, "GitHub installation id");
      const { Item } = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { recordKey: installationKey(installationId) },
        ConsistentRead: true,
      }));
      return publicInstallation(Item);
    },

    async deleteInstallation(installationId) {
      requiredId(installationId, "GitHub installation id");
      await documentClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { recordKey: installationKey(installationId) },
      }));
    },

    async putOAuthState({ nonce, ttlSeconds = OAUTH_STATE_TTL_SECONDS, purpose, accountId } = {}) {
      if (typeof nonce !== "string" || !nonce) throw new Error("GitHub OAuth state nonce is required.");
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("GitHub OAuth state TTL is invalid.");
      const expiresAt = nowSeconds() + ttlSeconds;
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          recordKey: stateKey(nonce),
          kind: "oauth-state",
          expiresAt,
          // A state may be bound to one purpose and one account (the
          // install flow); sign-in states carry neither field.
          ...(typeof purpose === "string" && purpose ? { purpose } : {}),
          ...(typeof accountId === "string" && accountId ? { accountId } : {}),
        },
      }));
      return { expiresAt };
    },

    // Single-use: the nonce record is atomically deleted by the consume
    // itself, so a replayed callback can never succeed twice. An expired
    // nonce is consumed too (and rejected), so it cannot be revived.
    // Returns the consumed record's binding ({ purpose, accountId },
    // either possibly undefined) or null when there is nothing valid to
    // consume.
    async consumeOAuthStateRecord(nonce) {
      if (typeof nonce !== "string" || !nonce) return null;
      let deleted;
      try {
        const result = await documentClient.send(new DeleteCommand({
          TableName: tableName,
          Key: { recordKey: stateKey(nonce) },
          ConditionExpression: "attribute_exists(recordKey)",
          ReturnValues: "ALL_OLD",
        }));
        deleted = result?.Attributes;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return null;
        throw error;
      }
      if (!deleted || deleted.kind !== "oauth-state") return null;
      if (!Number.isSafeInteger(deleted.expiresAt) || deleted.expiresAt <= nowSeconds()) return null;
      return {
        purpose: typeof deleted.purpose === "string" && deleted.purpose ? deleted.purpose : undefined,
        accountId: typeof deleted.accountId === "string" && deleted.accountId ? deleted.accountId : undefined,
      };
    },

    // The sign-in flow's consume: a purpose-bound state (e.g. an install
    // state) is NOT a sign-in state and never validates here.
    async consumeOAuthState(nonce) {
      const record = await this.consumeOAuthStateRecord(nonce);
      return record !== null && record.purpose === undefined;
    },

    async linkAccountInstallation({ accountId, installationId } = {}) {
      if (typeof accountId !== "string" || !accountId) throw new Error("SolveLang account id is required.");
      requiredId(installationId, "GitHub installation id");
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          recordKey: linkKey(accountId, installationId),
          kind: "account-link",
          accountId,
          installationId,
          createdAt: new Date(nowSeconds() * 1_000).toISOString(),
        },
      }));
      // Stamp the installation record too when it already exists, so the
      // record itself answers "whose is this" without a link lookup. A
      // not-yet-reported installation is fine: the link record stands on
      // its own and the stamp lands via putInstallation preservation.
      const existing = await this.getInstallation(installationId);
      if (existing && existing.accountId !== accountId) {
        await this.putInstallation({ ...existing, accountId });
      }
    },

    async listInstallationsForAccount(accountId) {
      if (typeof accountId !== "string" || !accountId) throw new Error("SolveLang account id is required.");
      const { Items } = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "begins_with(recordKey, :prefix)",
        ExpressionAttributeValues: { ":prefix": linkPrefix(accountId) },
        ConsistentRead: true,
      }));
      const links = (Items ?? []).filter((item) => item?.kind === "account-link" && Number.isSafeInteger(item.installationId));
      const installations = [];
      for (const link of links) {
        const installation = await this.getInstallation(link.installationId);
        if (installation) installations.push(installation);
      }
      return installations;
    },
  };
}
