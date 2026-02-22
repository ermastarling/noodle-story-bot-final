import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { REST } from "@discordjs/rest";
import { getIcon } from "./ui/icons.js";

(async () => {
  // Import discord.js
  const Discord = await import("discord.js").then(m => m.default || m);
  
  const Client = Discord.Client;
  const Intents = Discord.Intents;
  const MessageFlags = Discord.MessageFlags;

  if (!Client || !Intents) {
    console.error("❌ Failed to load discord.js properly");
    console.error("Discord exports:", Object.keys(Discord).slice(0, 20));
    process.exit(1);
  }

  // Now import the rest
  const { commandMap } = await import("./commands/index.js");
  const { startDailyResetScheduler } = await import("./jobs/dailyReset.js");
  const { startDailyRewardReminderScheduler } = await import("./jobs/dailyRewardReminders.js");
  const { startEventSyncScheduler } = await import("./jobs/eventSync.js");
  const { startDbBackupScheduler, runDbBackup } = await import("./jobs/backupDb.js");
  const {
    loadContentBundle,
    loadSettingsCatalog,
    loadBadgesContent,
    loadSpecializationsContent,
    loadDecorSetsContent,
    loadEventsContent
  } = await import("./content/index.js");
  const { openDb, getPlayer, withPlayerCache, upsertPlayer, getLatestServerIdForUser } = await import("./db/index.js");
  const { checkRateLimit } = await import("./infra/rateLimit.js");
  const { emitTelemetry } = await import("./infra/telemetry.js");
  const { getIdempotentResult, putIdempotentResult } = await import("./infra/idempotency.js");
  const { newPlayerProfile } = await import("./game/player.js");
  const { FORAGE_ITEM_IDS } = await import("./game/forage.js");
  const { getCustomEmojiEntries } = await import("./ui/icons.js");
  const { grantStoreBundle, resolveStoreBundleSpecId } = await import("./game/storeBundles.js");
  const { noodleCommand } = await import("./commands/noodle.js");
  const { noodleSocialCommand } = await import("./commands/noodleSocial.js");
  const { noodleStaffCommand, noodleStaffHandler, noodleStaffInteractionHandler } = await import("./commands/noodleStaff.js");
  const { noodleUpgradesCommand, noodleUpgradesHandler, noodleUpgradesInteractionHandler } = await import("./commands/noodleUpgrades.js");

  /* ------------------------------------------------------------------ */
  /*  Boot + diagnostics                                                 */
  /* ------------------------------------------------------------------ */

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const CWD = process.cwd();

  const LOG_PATH = path.join(CWD, "command-errors.log");
  const BOOT_PATH = path.join(CWD, "boot-ok.log");
  const USER_ERROR_DIR = path.join(CWD, "user-error-logs");
  const USER_ERROR_RETENTION_DAYS = 14;
  const USER_ERROR_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let lastUserErrorCleanup = 0;

  const errorLog = fs.createWriteStream(LOG_PATH, { flags: "a" });
  const origError = console.error;
  console.error = (...args) => {
    origError(...args);
    try {
      const line = args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      errorLog.write(`[${new Date().toISOString()}] ${line}\n`);
    } catch {
      // Ignore log write failures.
    }
  };

  console.log("✅ BOOTING FILE:", __filename);
  console.log("✅ CWD:", CWD);

  function getDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function cleanupUserErrorLogs(now = new Date()) {
    const nowMs = now.getTime();
    if (nowMs - lastUserErrorCleanup < USER_ERROR_CLEANUP_INTERVAL_MS) return;
    lastUserErrorCleanup = nowMs;

    try {
      fs.mkdirSync(USER_ERROR_DIR, { recursive: true });
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - USER_ERROR_RETENTION_DAYS);
      const entries = fs.readdirSync(USER_ERROR_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
        const dirDate = new Date(`${entry.name}T00:00:00Z`);
        if (Number.isNaN(dirDate.getTime())) continue;
        if (dirDate < cutoff) {
          fs.rmSync(path.join(USER_ERROR_DIR, entry.name), { recursive: true, force: true });
        }
      }
    } catch (err) {
      console.error("❌ Failed to cleanup user error logs:", err?.stack ?? err);
    }
  }

  function logUserError(interaction, label, detail) {
    const userId = interaction?.user?.id ?? interaction?.member?.user?.id ?? "unknown";
    const guildId = interaction?.guildId ?? "dm";
    const commandName = interaction?.commandName ?? interaction?.customId ?? "unknown";

    try {
      cleanupUserErrorLogs();
      const dateDir = path.join(USER_ERROR_DIR, getDateKey());
      fs.mkdirSync(dateDir, { recursive: true });
      const filePath = path.join(dateDir, `${userId}.log`);
      const line = `[${new Date().toISOString()}] ${label} guild=${guildId} cmd=${commandName}\n${detail}\n`;
      fs.appendFileSync(filePath, `${line}\n`);
    } catch (err) {
      console.error("❌ Failed to write user error log:", err?.stack ?? err);
    }
  }

  process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason?.stack ?? reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err?.stack ?? err);
  });

  /* ------------------------------------------------------------------ */
  /*  Client setup                                                       */
  /* ------------------------------------------------------------------ */

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("❌ Missing DISCORD_TOKEN in .env");
    process.exit(1);
  }

  const client = new Client({
    intents: [
      Intents.FLAGS.GUILDS,
      Intents.FLAGS.GUILD_MESSAGES,
      Intents.FLAGS.DIRECT_MESSAGES,
      Intents.FLAGS.MESSAGE_CONTENT
    ]
  });

  const db = openDb();
  const { withEventRecipes } = await import("./game/events.js");
  const baseContent = loadContentBundle(1);
  const eventsContent = loadEventsContent();
  const content = withEventRecipes(baseContent, eventsContent);
  const settingsCatalog = loadSettingsCatalog();
  const badgesContent = loadBadgesContent();
  const specializationsContent = loadSpecializationsContent();
  const decorSetsContent = loadDecorSetsContent();

  function getUnlockedIngredientIds(player, content) {
    const out = new Set();
    const known = Array.isArray(player?.known_recipes) ? player.known_recipes : [];

    for (const recipeId of known) {
      const r = content.recipes?.[recipeId];
      if (!r) continue;

      for (const ing of (r.ingredients ?? [])) {
        if (ing?.item_id) out.add(ing.item_id);
      }
    }

    return out;
  }

  async function getKnownServerIds() {
    return [...client.guilds.cache.keys()];
  }

  async function resolveAccessibleEmojiIds(client, token) {
    const ids = new Set();
    let applicationEmojiCount = 0;

    if (!token) return { ids, applicationEmojiCount };

    const applicationId = client.application?.id ?? client.user?.id;
    if (!applicationId) return { ids, applicationEmojiCount };

    if (client.application) {
      try {
        await client.application.fetch();
      } catch (error) {
        console.error("⚠️ Unable to refresh application metadata:", error?.message ?? error);
      }
    }

    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const response = await rest.get(`/applications/${applicationId}/emojis`);
      const emojiItems = Array.isArray(response?.items)
        ? response.items
        : Array.isArray(response)
          ? response
          : [];
      applicationEmojiCount = emojiItems.length;
      for (const emoji of emojiItems) {
        if (emoji?.id) ids.add(emoji.id);
      }
    } catch (error) {
      console.error("⚠️ Unable to fetch application emojis:", error?.message ?? error);
    }

    return { ids, applicationEmojiCount };
  }

  function getWebhookRawBody(req, { limitBytes = 1_000_000 } = {}) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on("data", (chunk) => {
        total += chunk.length;
        if (total > limitBytes) {
          reject(new Error("Payload too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function decodeWebhookBody(rawBody, encoding) {
    if (!rawBody || !rawBody.length) return rawBody;
    const enc = String(encoding || "").toLowerCase();
    if (enc.includes("gzip")) {
      return await new Promise((resolve, reject) =>
        zlib.gunzip(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    if (enc.includes("deflate")) {
      return await new Promise((resolve, reject) =>
        zlib.inflate(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    if (enc.includes("br")) {
      return await new Promise((resolve, reject) =>
        zlib.brotliDecompress(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    return rawBody;
  }

  function parseWebhookPayload(decodedBody, contentType) {
    const bodyText = decodedBody?.toString("utf8") || "";
    const ct = String(contentType || "").toLowerCase();

    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("text/plain")) {
      const params = new URLSearchParams(bodyText);
      const obj = {};
      for (const [key, value] of params.entries()) obj[key] = value;
      return { ok: true, value: obj };
    }

    try {
      return { ok: true, value: JSON.parse(bodyText || "{}") };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function buildDiscordPublicKey(publicKeyHex) {
    const keyBytes = Buffer.from(publicKeyHex, "hex");
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    return crypto.createPublicKey({ key: Buffer.concat([prefix, keyBytes]), format: "der", type: "spki" });
  }

  function timingSafeEqual(a, b) {
    if (!a || !b) return false;
    const aBuf = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    const bBuf = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  function verifyDiscordSignature({ publicKeyHex, signature, timestamp, rawBody }) {
    if (!publicKeyHex || !signature || !timestamp || !rawBody) return false;
    try {
      const publicKey = buildDiscordPublicKey(publicKeyHex);
      const signatureBytes = Buffer.from(signature, "hex");
      const message = Buffer.concat([Buffer.from(String(timestamp)), rawBody]);
      return crypto.verify(null, message, publicKey, signatureBytes);
    } catch (error) {
      console.error("⚠️ Discord webhook signature verify failed:", error?.message ?? error);
      return false;
    }
  }

  function verifyWooSignature({ secret, signature, rawBody }) {
    if (!secret || !signature || !rawBody) return false;
    try {
      const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
      const normalized = String(signature || "").trim();
      return timingSafeEqual(digest, normalized);
    } catch (error) {
      console.error("WC: Signature verify failed:", error?.message ?? error);
      return false;
    }
  }

  function extractEntitlementPayload(payload) {
    const data = payload?.data ?? payload?.d ?? payload?.entitlement ?? payload?.event?.data ?? payload?.event ?? payload;
    const rawEventType = String(
      payload?.type ?? payload?.event_type ?? payload?.t ?? data?.type ?? payload?.event?.type ?? ""
    ).toUpperCase();
    const numericType = Number(rawEventType);
    const eventType = Number.isFinite(numericType)
      ? (numericType === 1 ? "ENTITLEMENT_CREATE" : numericType === 2 ? "ENTITLEMENT_UPDATE" : numericType === 3 ? "ENTITLEMENT_DELETE" : rawEventType)
      : rawEventType;
    return {
      eventType,
      skuId: data?.sku_id ?? data?.skuId ?? payload?.sku_id ?? payload?.skuId ?? null,
      userId: data?.user_id ?? data?.userId ?? payload?.user_id ?? payload?.userId ?? null,
      guildId: data?.guild_id ?? data?.guildId ?? payload?.guild_id ?? payload?.guildId ?? null,
      entitlementId: data?.id ?? data?.entitlement_id ?? payload?.entitlement_id ?? payload?.id ?? null
    };
  }

  function extractWooDiscordId(order, explicitKey) {
    const keys = [explicitKey, "discord_id", "discord_user_id", "discordId", "discord_user"].filter(Boolean);
    const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];
    for (const key of keys) {
      const found = meta.find((entry) => String(entry?.key || "") === key);
      if (found?.value) return String(found.value).trim();
    }
    return null;
  }

  function startEntitlementWebhookServer() {
    const port = Number(process.env.NOODLE_WEBHOOK_PORT || 0);
    const webhookPath = process.env.NOODLE_WEBHOOK_PATH || "/discord/entitlements";
    const wcWebhookPath = process.env.NOODLE_WC_WEBHOOK_PATH || "/store/woocommerce";
    const publicKeyHex = process.env.DISCORD_PUBLIC_KEY || "";
    const wcSecret = process.env.NOODLE_WC_WEBHOOK_SECRET || "";
    const wcDiscordIdKey = process.env.NOODLE_WC_DISCORD_ID_FIELD || "discord_id";

    if (!port) {
        console.log("INFO: Discord store webhook disabled (NOODLE_WEBHOOK_PORT not set).");
      return;
    }
    if (!publicKeyHex) {
      console.error("❌ Missing DISCORD_PUBLIC_KEY; webhook server not started.");
      return;
    }

    const server = http.createServer(async (req, res) => {
      const urlPath = (req.url || "").split("?")[0];
      if (req.method !== "POST" || (urlPath !== webhookPath && urlPath !== wcWebhookPath)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }

      let rawBody;
      try {
        rawBody = await getWebhookRawBody(req);
      } catch (error) {
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("payload too large");
        return;
      }

      const encoding = req.headers["content-encoding"];
      const decodedBody = await decodeWebhookBody(rawBody, encoding);
      const parsed = parseWebhookPayload(decodedBody, req.headers["content-type"]);
      if (!parsed.ok) {
        console.error("WEBHOOK: Invalid JSON body:", parsed.error?.message ?? parsed.error);
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("invalid json");
        return;
      }
      const payload = parsed.value ?? {};

      if (urlPath === webhookPath) {
        const signature = req.headers["x-signature-ed25519"];
        const timestamp = req.headers["x-signature-timestamp"];
        const signatureOk = verifyDiscordSignature({
          publicKeyHex,
          signature,
          timestamp,
          rawBody
        });
        if (!signatureOk) {
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("invalid signature");
          return;
        }

        const { eventType, skuId, userId, guildId, entitlementId } = extractEntitlementPayload(payload);
        console.log(
          "WEBHOOK: Entitlement event",
          JSON.stringify({ eventType, skuId, userId, guildId, entitlementId })
        );
        const normalizedEvent = eventType || "UNKNOWN";
        if (normalizedEvent && !["ENTITLEMENT_CREATE", "ENTITLEMENT_UPDATE", "UNKNOWN"].includes(normalizedEvent)) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ignored");
          return;
        }

        if (!skuId || !userId) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ignored");
          return;
        }

        const specId = resolveStoreBundleSpecId(skuId);
        if (!specId) {
          console.log("WEBHOOK: Unknown SKU", skuId);
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("unknown sku");
          return;
        }

        if (!db) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("db unavailable");
          return;
        }

        const idempotencyKey = entitlementId ? `entitlement:${entitlementId}` : null;
        if (idempotencyKey) {
          const cached = getIdempotentResult(db, idempotencyKey);
          if (cached) {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("ok");
            return;
          }
        }

        const serverId = guildId || getLatestServerIdForUser(db, userId);
        if (!serverId) {
          console.log("WEBHOOK: Missing server for user", userId);
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing server");
          return;
        }

        let player = getPlayer(db, serverId, userId);
        if (!player) player = newPlayerProfile(userId);

        const result = grantStoreBundle({
          player,
          specId,
          specializationsContent,
          decorSetsContent,
          coins: 10000
        });
        console.log(
          "WEBHOOK: Grant result",
          JSON.stringify({ ok: result.ok, reason: result.reason, specId, serverId, userId })
        );

        if (result.ok) {
          upsertPlayer(db, serverId, userId, player, null, player.schema_version);
          if (idempotencyKey) {
            putIdempotentResult(db, {
              key: idempotencyKey,
              userId,
              action: "entitlement_grant",
              ttlSeconds: 60 * 60 * 24 * 30,
              result: { ok: true, specId }
            });
          }
        }

        res.writeHead(200, { "content-type": "text/plain" });
        res.end(result.ok || result.reason === "Already unlocked." ? "ok" : "ignored");
        return;
      }

      if (urlPath === wcWebhookPath) {
        if (!wcSecret) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("missing wc secret");
          return;
        }

        const signature = req.headers["x-wc-webhook-signature"];
        if (!signature) {
          const headerKeys = Object.keys(req.headers || {}).sort();
          console.log("WC: Missing signature header", JSON.stringify({ headers: headerKeys }));
        }
        const signatureOk = verifyWooSignature({ secret: wcSecret, signature, rawBody });
        if (!signatureOk) {
          console.log("WC: Invalid signature", {
            signature: signature ? String(signature).slice(0, 8) : null,
            topic: req.headers["x-wc-webhook-topic"] || null,
            deliveryId: req.headers["x-wc-webhook-delivery-id"] || null
          });
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("invalid signature");
          return;
        }

        if (!db) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("db unavailable");
          return;
        }

        const order = payload;
        const orderId = order?.id ?? null;
        const status = String(order?.status || "").toLowerCase();
        if (!orderId && order?.webhook_id) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
          return;
        }
        if (status !== "completed") {
          console.log("WC: Ignored order with status", status, orderId);
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ignored");
          return;
        }
        const discordId = extractWooDiscordId(order, wcDiscordIdKey);
        const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];
        console.log(
          "WC: Order event",
          JSON.stringify({ orderId, discordId, lineItems: lineItems.length })
        );

        if (!discordId || !lineItems.length) {
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing discord id or items");
          return;
        }

        const idempotencyKey = orderId ? `wc_order:${orderId}` : null;
        if (idempotencyKey) {
          const cached = getIdempotentResult(db, idempotencyKey);
          if (cached) {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("ok");
            return;
          }
        }

        const serverId = getLatestServerIdForUser(db, discordId);
        if (!serverId) {
          console.log("WC: Missing server for user", discordId);
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing server");
          return;
        }

        let player = getPlayer(db, serverId, discordId);
        if (!player) player = newPlayerProfile(discordId);

        const grants = [];
        for (const item of lineItems) {
          const specId = String(item?.sku || "").trim();
          if (!specId) continue;
          const result = grantStoreBundle({
            player,
            specId,
            specializationsContent,
            decorSetsContent,
            coins: 10000
          });
          grants.push({ specId, ok: result.ok, reason: result.reason });
        }

        upsertPlayer(db, serverId, discordId, player, null, player.schema_version);
        if (idempotencyKey) {
          putIdempotentResult(db, {
            key: idempotencyKey,
            userId: discordId,
            action: "wc_order",
            ttlSeconds: 60 * 60 * 24 * 30,
            result: { ok: true, grants }
          });
        }

        console.log("WC: Grant result", JSON.stringify(grants));
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
    });

    server.listen(port, () => {
      console.log(`OK: Discord store webhook listening on ${port}${webhookPath}`);
      console.log(`OK: WooCommerce webhook listening on ${port}${wcWebhookPath}`);
    });
  }


  client.once("ready", async (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);

    const customEmojis = getCustomEmojiEntries();
    const { ids: accessibleEmojiIds, applicationEmojiCount } = await resolveAccessibleEmojiIds(client, token);
    const missingEmojis = customEmojis.filter((emoji) => !accessibleEmojiIds.has(emoji.id));
    if (missingEmojis.length) {
      const missingList = missingEmojis
        .map((emoji) => `${emoji.key} -> ${emoji.name}:${emoji.id}`)
        .join(", ");
      console.error("❌ Missing custom emojis for this bot:");
      console.error(missingList);
      console.error("Ensure the bot is authorized for the emoji host application or update content/icons.json IDs.");
      console.error(`(Application emojis available: ${applicationEmojiCount})`);
    } else {
      console.log(
        `✅ Custom emoji check passed (${customEmojis.length} entries, application emojis available: ${applicationEmojiCount}).`
      );
    }

    try {
      fs.writeFileSync(
        BOOT_PATH,
        `Boot OK\nTime: ${new Date().toISOString()}\nFile: ${__filename}\nCWD: ${CWD}\n`
      );
      console.log("✅ Boot marker written:", BOOT_PATH);
    } catch (e) {
      console.error("❌ Failed to write boot marker:", e?.stack ?? e);
    }

    startDailyResetScheduler(getKnownServerIds);
    startDailyRewardReminderScheduler(client, getKnownServerIds);
    startEventSyncScheduler(getKnownServerIds);
    startDbBackupScheduler(db);

    const backupOnStart = process.env.NOODLE_BACKUP_ON_START !== "0";
    if (backupOnStart) {
      setTimeout(() => {
        runDbBackup(db, "startup");
      }, 60_000);
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Interaction handling                                               */
  /* ------------------------------------------------------------------ */

  client.on("interactionCreate", async (interaction) => {
    return withPlayerCache(async () => {
    const startTime = Date.now();
    
    // Check interaction age - Discord invalidates after 3 seconds
    const createdAt = interaction.createdTimestamp;
    const age = Date.now() - createdAt;
    if (age > 2800) {
      console.error(`Interaction is ${age}ms old, likely to expire. Skipping.`);
      return;
    }
    
    // IMMEDIATELY defer buttons/selects/modals FIRST, before ANY other logic
    // Note: Discord.js v13 uses isSelectMenu(), not isStringSelectMenu()
    const isBtn = interaction.isButton?.();
    const isSelect = interaction.isSelectMenu?.();
    const isModal = interaction.isModalSubmit?.();
    const cid = interaction.customId;
    const isNoodle = cid?.startsWith("noodle:");
    const isNoodleSocial = cid?.startsWith("noodle-social:");
    const isNoodleStaff = cid?.startsWith("noodle-staff:");
    const isNoodleUpgrades = cid?.startsWith("noodle-upgrades:");
    
    const alreadyAck = interaction.deferred || interaction.replied;

    // Defer buttons/selects with deferUpdate (updates original message)
    // BUT: Don't defer buttons/selects that will show modals
    if (!alreadyAck && (isBtn || isSelect)) {
      if (isNoodle || isNoodleSocial || isNoodleStaff || isNoodleUpgrades) {
        // Check if this button/select will show a modal
        const willShowModal = cid?.includes("pick:cook_select:") ||
                cid?.includes("action:party_create") ||
                cid?.includes("action:party_join") ||
                cid?.includes("action:party_invite") ||
                cid?.includes("action:tip") ||
                cid?.includes("action:bless") ||
          cid?.includes("profile:edit_shop_name") ||
          cid?.includes("profile:edit_tagline") ||
                cid?.includes("action:shared_order_contribute") ||
                cid?.includes("select:shared_order_ingredient");
        
        // Buttons that update message immediately without database operations
        const skipDeferButtons = cid?.includes("action:shared_order_confirm_complete") ||
                cid?.includes("action:shared_order_abort_cancel") ||
                cid?.includes("action:shared_order_cancel_complete");
        
        if (!willShowModal && !skipDeferButtons && !isNoodleStaff) {
          const deferStart = Date.now();
          try {
            await interaction.deferUpdate();
          } catch (e) {
            console.error(`Button/select defer failed (age was ${age}ms):`, e?.message);
            // If defer failed due to unknown interaction, skip processing
            if (e?.message?.includes("Unknown interaction") || e?.code === 10062) {
              console.error("Skipping handler - interaction expired");
              return;
            }
            // Continue processing - handler may be able to respond directly
          }
        }
      }
    }

    /* ---------- AUTOCOMPLETE ---------- */
    if (interaction.isAutocomplete()) {
      try {
        if (interaction.commandName !== "noodle") return;

        const sub = interaction.options.getSubcommand(false);
        const focused = interaction.options.getFocused(true);
        const q = String(focused?.value ?? "").toLowerCase();

        // ✅ Cook autocomplete (known recipes only)
        if (sub === "cook" && focused.name === "recipe") {
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
          // Include temporary recipes from resilience
          const permanent = p.known_recipes || [];
          const temporary = p.resilience?.temp_recipes || [];
          const known = [...new Set([...permanent, ...temporary])];

          const results = known
            .map((id) => {
              const r = content.recipes?.[id];
              const name = r?.name ?? id;
              return { id, name };
            })
            .filter(x =>
              x.id.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(x => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Badge autocomplete (owned badges)
        if (sub === "badge_set" && focused.name === "badge_id") {
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
          const owned = Array.isArray(p.profile?.badges) ? p.profile.badges : [];
          const results = owned
            .map((id) => {
              const badge = badgesContent?.badges?.find((b) => b.badge_id === id);
              const name = badge?.name ?? id;
              return { id, name };
            })
            .filter((x) =>
              x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map((x) => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Specialization autocomplete
        if (sub === "specialize" && focused.name === "spec") {
          const results = (specializationsContent?.specializations ?? [])
            .map((spec) => ({ id: spec.spec_id, name: spec.name }))
            .filter((x) =>
              x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map((x) => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Market autocomplete (buy/sell) — only ingredients used by unlocked recipes
        if ((sub === "buy" || sub === "sell") && focused.name === "item") {
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
          const allowed = getUnlockedIngredientIds(p, content);

          const results = Object.values(content.items ?? {})
            .filter(it => it && it.item_id && (it.acquisition === "market" || it.base_price))
            .filter(it => allowed.has(it.item_id))
            .filter(it => it.name?.toLowerCase().includes(q) || it.item_id.toLowerCase().includes(q))
            .slice(0, 25)
            .map(it => ({
              name: String(it.name ?? it.item_id).slice(0, 100),
              value: String(it.item_id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Forage autocomplete (unlocked forage items only)
        if (sub === "forage" && focused.name === "item") {
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
          const allowed = getUnlockedIngredientIds(p, content);
          const allowedForage = (FORAGE_ITEM_IDS ?? []).filter(id => allowed.has(id));

          const results = allowedForage
            .map(id => ({ id, name: content.items?.[id]?.name ?? id }))
            .filter(x =>
              x.id.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(x => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        return interaction.respond([]);
      } catch (e) {
        console.error("AUTOCOMPLETE ERROR:", e?.stack ?? e);
        try { return interaction.respond([]); } catch { return; }
      }
    }

    const userId = interaction.user?.id ?? null;
    const serverId = interaction.guildId ?? null;
    const rateLimit = checkRateLimit({
      userId,
      serverId,
      userLimit: 50,
      serverLimit: 400
    });

    if (!rateLimit.allowed) {
      emitTelemetry("rate_limited", {
        scope: rateLimit.scope,
        userId,
        serverId,
        count: rateLimit.count,
        limit: rateLimit.limit
      });

      const slowDownMsg = "Please don't spam interactions! Try again in a bit.";
      try {
        if (interaction.replied || interaction.deferred) {
          return interaction.followUp({ content: slowDownMsg, ephemeral: true });
        }
        return interaction.reply({ content: slowDownMsg, ephemeral: true });
      } catch (e) {
        console.error("RATE LIMIT REPLY ERROR:", e?.message ?? e);
        return;
      }
    }

    /* ---------- NOODLE UI COMPONENTS ---------- */
    if (interaction.isButton?.() || interaction.isSelectMenu?.() || interaction.isModalSubmit?.()) {
      try {
        const id = interaction.customId || "";
        if (id.startsWith("noodle:")) {
          // Already deferred at the top of interactionCreate handler
          return await noodleCommand.handleComponent(interaction);
        }
        if (id.startsWith("noodle-social:")) {
          // Already deferred at the top of interactionCreate handler
          return await noodleSocialCommand.handleComponent(interaction);
        }
        if (id.startsWith("noodle-staff:")) {
          const result = await noodleStaffInteractionHandler(interaction);
          if (result) {
            if (result.ephemeral) {
              if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ ...result, ephemeral: true });
              }
              return await interaction.reply({ ...result, ephemeral: true });
            }
            if (interaction.replied || interaction.deferred) {
              return await interaction.editReply(result);
            }
            return await interaction.update(result);
          }
        }
        if (id.startsWith("noodle-upgrades:")) {
          const result = await noodleUpgradesInteractionHandler(interaction);
          if (result) {
            if (result.ephemeral) {
              if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ ...result, ephemeral: true });
              }
              return await interaction.reply({ ...result, ephemeral: true });
            }
            if (interaction.replied || interaction.deferred) {
              return await interaction.editReply(result);
            }
            return await interaction.update(result);
          }
        }
      } catch (e) {
        const detail = e?.stack ?? String(e);
        console.error("NOODLE COMPONENT ERROR:", detail);
        logUserError(interaction, "component_error", detail);
        // Don't try to respond if interaction is already acknowledged or unknown
        if (e?.code === 10062 || e?.message?.includes("Unknown interaction") || 
            e?.message?.includes("already been acknowledged")) {
          console.log(`⏭️  Skipping error reply - interaction invalid or already handled`);
          return;
        }
        try {
          if (interaction.replied || interaction.deferred) {
            return interaction.followUp({ content: "Something went a little sideways, try again.", ephemeral: true });
          }
          return interaction.reply({ content: "Something went a little sideways, try again.", flags: MessageFlags.Ephemeral });
        } catch {}
        return;
      }
    }

    /* ---------- SLASH COMMANDS ---------- */
    const isChatInput = interaction.isChatInputCommand?.() || interaction.isCommand?.();
    if (!isChatInput) return;

    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction);
    } catch (e) {
      const detail = e?.stack ?? String(e);
      console.error("COMMAND ERROR:", detail);
      logUserError(interaction, "command_error", detail);

      try {
        fs.appendFileSync(LOG_PATH, `\n[${new Date().toISOString()}]\n${detail}\n`);
        console.log(`📋 Error written to:`, LOG_PATH);
      } catch (err) {
        console.error("❌ Failed to write error log:", err?.stack ?? err);
      }

      try {
        const msg = "Something went a little sideways, try again.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      } catch (replyErr) {
        console.error("❌ Failed to send error reply:", replyErr?.message ?? replyErr);
      }
    }
    });
  });

  startEntitlementWebhookServer();

  client.login(token);
})();
