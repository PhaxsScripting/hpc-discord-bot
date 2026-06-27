const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle
} = require("discord.js");
const axios = require("axios");

// ─── Constants ───────────────────────────────────────────────────────────────

const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const BOT_SECRET      = process.env.BOT_SECRET;
const API_URL         = process.env.API_URL;
const CLIENT_ID       = process.env.CLIENT_ID;

const BLACKLIST_ROLE_ID = "1195557302250524764";
const ALLOWED_ROLE_IDS  = [
  "1390336483277144064",
  "1398071632207151184",
  "1422406753231966290",
  "1398071208343244870"
];

// Your Roblox Universe ID — find it in Roblox Studio → Game Settings → Basic Info
const ROBLOX_UNIVERSE_ID = "9304641174";

const WEBHOOK_COMMANDS   = "https://discord.com/api/webhooks/1520230687049908364/FANxy6d9H3yukPf2lis6ZnDHS_3VN9m1aUGao3ofeEGdcFtzZ0LQ3sIkF5n1oC-at57p";
const WEBHOOK_BLACKLIST  = "https://discord.com/api/webhooks/1520233138767265922/YZGiw-27WhGD3HQxWDGJTvzFf9q_-dzxqPawAqdOqAC6-YmCH-ZBLlPYm_ju8y5QU20u";
const WEBHOOK_SERVERSTATUS = "https://discord.com/api/webhooks/1520308334501036132/tm9oL1Wp_vUMsiUIw8MAu0AKbVjamiQ_Yo7juiy0T2fJ_dvEUNJh20qy7dtiZSk_9P4R";
// WEBHOOK_KICKLOG is used by the backend, not the bot directly — see api/blacklist/kick.js

const PAGE_SIZE = 10;
const SERVER_STATUS_INTERVAL_MS = 60_000; // post every 60 seconds

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp() {
  return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

async function sendWebhook(url, payload) {
  // payload can be a string (content) or an object (embeds etc.)
  const body = typeof payload === "string" ? { content: payload } : payload;
  try {
    await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[Bot] Webhook send failed:`, err.message);
  }
}

async function isAlreadyBlacklisted(robloxId) {
  try {
    const response = await axios.get(`${API_URL}/api/check/${robloxId}`);
    return response.data?.blacklisted === true;
  } catch (err) {
    console.error(`[Bot] Could not check blacklist status for ${robloxId}:`, err.message);
    return false;
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

// ─── Roblox helpers ──────────────────────────────────────────────────────────

function extractRobloxUsername(displayName) {
  const parts = displayName.split("|");
  const lastPart = parts[parts.length - 1].trim();
  return lastPart || displayName.trim();
}

async function getRobloxIdFromUsername(username) {
  const response = await axios.post(
    "https://users.roblox.com/v1/usernames/users",
    { usernames: [username], excludeBannedUsers: false },
    { headers: { "Content-Type": "application/json" } }
  );
  const match = response.data?.data?.[0];
  return match ? { id: match.id, name: match.name } : null;
}

async function resolveRobloxUser(member) {
  const displayName  = member.displayName;
  const robloxUsername = extractRobloxUsername(displayName);
  const robloxUser   = await getRobloxIdFromUsername(robloxUsername);

  if (!robloxUser) {
    console.error(`[Bot] No Roblox user found for "${robloxUsername}" (display: "${displayName}")`);
    return null;
  }
  if (robloxUser.name.toLowerCase() !== robloxUsername.toLowerCase()) {
    console.warn(`[Bot] Username mismatch — queried "${robloxUsername}", Roblox returned "${robloxUser.name}". Skipping.`);
    return null;
  }
  return robloxUser;
}

// ─── Blacklist candidate helpers ─────────────────────────────────────────────

async function addBlacklistCandidate(member, fromStartup = false) {
  console.log(`[Bot] Adding blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST,
        `${timestamp()} ⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — no blacklist entry created.`);
      return;
    }

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxUser.id);
    if (alreadyBlacklisted) {
      if (!fromStartup) {
        await sendWebhook(WEBHOOK_BLACKLIST,
          `${timestamp()} ℹ️ **${robloxUser.name}** (\`${robloxUser.id}\`) is already blacklisted — skipped.`);
      }
      console.log(`[Bot] ${robloxUser.name} already blacklisted, skipping.`);
      return;
    }

    const response = await axios.post(
      `${API_URL}/api/blacklist/add`,
      {
        robloxId: robloxUser.id,
        robloxUsername: robloxUser.name,
        discordId: member.id,
        discordUsername: member.user.tag
      },
      { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
    );

    if (response.data.success) {
      console.log(`[Bot] Blacklisted ${robloxUser.name} (${robloxUser.id}) via ${member.displayName}`);
      await sendWebhook(WEBHOOK_BLACKLIST,
        `${timestamp()} ✅ Blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role given to ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error adding blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST,
      `${timestamp()} ❌ Error blacklisting **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

async function removeBlacklistCandidate(member) {
  console.log(`[Bot] Removing blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST,
        `${timestamp()} ⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — nothing removed.`);
      return;
    }

    const response = await axios.post(
      `${API_URL}/api/blacklist/remove`,
      { robloxId: robloxUser.id },
      { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
    );

    if (response.data.success) {
      console.log(`[Bot] Un-blacklisted ${robloxUser.name} (${robloxUser.id}) — role removed from ${member.displayName}`);
      await sendWebhook(WEBHOOK_BLACKLIST,
        `${timestamp()} 🔓 Un-blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role removed from ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error removing blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST,
      `${timestamp()} ❌ Error removing blacklist for **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

// ─── /checkblacklist embed builders ─────────────────────────────────────────

function buildBlacklistEmbed(entries, page, totalPages) {
  const start       = page * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);

  const description = pageEntries.map((entry, i) => {
    const num         = start + i + 1;
    const robloxName  = entry.robloxUsername || "Unknown";
    const robloxId    = entry.robloxId       || "Unknown";
    const discordName = entry.discordUsername || "Unknown";
    const reason      = entry.reason          || "No reason provided";
    return `**${num}.** ${robloxName} (\`${robloxId}\`)\n　Discord: ${discordName}\n　Reason: ${reason}`;
  }).join("\n\n");

  return new EmbedBuilder()
    .setTitle("🚫 Blacklisted Users")
    .setDescription(description || "No entries.")
    .setColor(0xff0000)
    .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${entries.length} total` })
    .setTimestamp();
}

function buildPageButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bl_prev")
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId("bl_next")
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

// ─── Live server status poller ───────────────────────────────────────────────

async function postServerStatus() {
  try {
    const [gameRes, thumbRes] = await Promise.allSettled([
      axios.get(`https://games.roblox.com/v1/games?universeIds=${ROBLOX_UNIVERSE_ID}`),
      axios.get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ROBLOX_UNIVERSE_ID}&size=512x512&format=Png&isCircular=false`)
    ]);

    const gameData  = gameRes.status === "fulfilled" ? gameRes.value.data?.data?.[0] : null;
    const thumbUrl  = thumbRes.status === "fulfilled" ? thumbRes.value.data?.data?.[0]?.imageUrl : null;

    const playerCount  = gameData?.playing    ?? "N/A";
    const visiting     = gameData?.visits     ?? "N/A";
    const gameName     = gameData?.name       ?? "HPC";
    const maxPlayers   = gameData?.maxPlayers ?? "N/A";

    const embed = new EmbedBuilder()
      .setTitle(`🎮 ${gameName} — Live Status`)
      .setColor(playerCount > 0 ? 0x00cc44 : 0x888888)
      .addFields(
        { name: "🟢 Players In-Game", value: String(playerCount), inline: true },
        { name: "🏆 Total Visits",    value: Number(visiting).toLocaleString(), inline: true },
        { name: "👥 Max Players",     value: String(maxPlayers), inline: true }
      )
      .setFooter({ text: "Updates every 60 seconds" })
      .setTimestamp();

    if (thumbUrl) embed.setThumbnail(thumbUrl);

    await sendWebhook(WEBHOOK_SERVERSTATUS, { embeds: [embed.toJSON()] });
  } catch (err) {
    console.error("[Bot] Server status poll failed:", err.message);
  }
}

// ─── Ready ───────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);

  // Register slash commands
  try {
    const commands = [
      new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Manually blacklist a Roblox user by username")
        .addStringOption(opt =>
          opt.setName("username").setDescription("Roblox username").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("unblacklist")
        .setDescription("Remove a Roblox user from the blacklist by username")
        .addStringOption(opt =>
          opt.setName("username").setDescription("Roblox username").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("removebyrobloxid")
        .setDescription("Remove a blacklisted user directly by their Roblox ID (bypasses username lookup)")
        .addStringOption(opt =>
          opt.setName("id").setDescription("Roblox user ID (numbers only)").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("blacklistreason")
        .setDescription("Set or update the reason for a blacklisted user")
        .addStringOption(opt =>
          opt.setName("username").setDescription("Roblox username").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("reason").setDescription("Reason for the blacklist").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("blacklistinfo")
        .setDescription("Show full details for a specific blacklisted user")
        .addStringOption(opt =>
          opt.setName("username").setDescription("Roblox username").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("checkblacklist")
        .setDescription("Show all currently blacklisted users")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("[Bot] Slash commands registered");
  } catch (err) {
    console.error("[Bot] Failed to register slash commands:", err.message);
  }

  // Startup sweep — blacklist anyone who already has the role
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      console.log(`[Bot] Cached members for guild: ${guild.name}`);

      const role = guild.roles.cache.get(BLACKLIST_ROLE_ID);
      if (!role) {
        console.error(`[Bot] Role ID ${BLACKLIST_ROLE_ID} not found in ${guild.name}`);
        continue;
      }

      console.log(`[Bot] Sweeping ${role.members.size} member(s) with blacklist role`);
      for (const member of role.members.values()) {
        await addBlacklistCandidate(member, true);
      }
    } catch (err) {
      console.error(`[Bot] Failed to cache members for ${guild.name}:`, err.message);
    }
  }

  // Start live server status poller
  if (ROBLOX_UNIVERSE_ID !== "YOUR_UNIVERSE_ID_HERE") {
    postServerStatus(); // immediate first post
    setInterval(postServerStatus, SERVER_STATUS_INTERVAL_MS);
    console.log("[Bot] Server status poller started");
  } else {
    console.warn("[Bot] ROBLOX_UNIVERSE_ID not set — server status poller disabled");
  }
});

// ─── Role events ─────────────────────────────────────────────────────────────

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const hadRole = oldMember.roles.cache.has(BLACKLIST_ROLE_ID);
  const hasRole = newMember.roles.cache.has(BLACKLIST_ROLE_ID);

  if (!hadRole && hasRole) {
    console.log(`[Bot] Blacklist role given to ${newMember.user.tag}`);
    await addBlacklistCandidate(newMember);
  } else if (hadRole && !hasRole) {
    console.log(`[Bot] Blacklist role removed from ${newMember.user.tag}`);
    await removeBlacklistCandidate(newMember);
  }
});

// ─── Member leave — keep them blacklisted in DB ───────────────────────────────
// If someone has the blacklist role and leaves the server, their KV entry stays.
// When they rejoin, we check KV and re-give them the role automatically.

client.on("guildMemberRemove", async (member) => {
  try {
    // member.roles may be partial if the member left — check cache
    const hadBlacklistRole = member.roles?.cache?.has(BLACKLIST_ROLE_ID);
    if (!hadBlacklistRole) return;

    console.log(`[Bot] Blacklisted member left server: ${member.user.tag} — KV entry preserved.`);
    await sendWebhook(WEBHOOK_BLACKLIST,
      `${timestamp()} 🚪 **${member.user.tag}** (had blacklist role) left the server — blacklist entry **preserved** in database.`);
    // We intentionally do NOT call removeBlacklistCandidate — the DB entry stays.
  } catch (err) {
    console.error("[Bot] guildMemberRemove error:", err.message);
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    // Look up their Discord ID in the blacklist metadata to see if they were blacklisted before
    const listRes = await axios.get(
      `${API_URL}/api/blacklist/list`,
      { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
    );

    const entries = listRes.data?.entries ?? [];
    const match   = entries.find(e => e.discordId === member.id);

    if (match) {
      console.log(`[Bot] Rejoining member ${member.user.tag} is blacklisted (robloxId: ${match.robloxId}) — re-assigning role.`);

      const role = member.guild.roles.cache.get(BLACKLIST_ROLE_ID);
      if (role) {
        await member.roles.add(role);
        await sendWebhook(WEBHOOK_BLACKLIST,
          `${timestamp()} 🔄 **${member.user.tag}** rejoined and is blacklisted — role **re-assigned** automatically. (Roblox: ${match.robloxUsername ?? match.robloxId})`);
      } else {
        console.error("[Bot] Blacklist role not found in guild on rejoin.");
      }
    }
  } catch (err) {
    console.error("[Bot] guildMemberAdd blacklist check error:", err.message);
  }
});

// ─── Interactions ─────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Pagination buttons (/checkblacklist pages) ──
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith("bl_")) return;

    const embed       = interaction.message.embeds[0];
    if (!embed) return;

    const footerMatch = embed.footer?.text?.match(/Page (\d+) of (\d+)/);
    if (!footerMatch) return;

    let page           = parseInt(footerMatch[1]) - 1;
    const totalPages   = parseInt(footerMatch[2]);

    if (interaction.customId === "bl_prev") page = Math.max(0, page - 1);
    if (interaction.customId === "bl_next") page = Math.min(totalPages - 1, page + 1);

    try {
      const kvResponse = await axios.get(
        `${API_URL}/api/blacklist/list`,
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );
      const entries  = kvResponse.data?.entries ?? [];
      const newEmbed = buildBlacklistEmbed(entries, page, totalPages);
      const newRow   = buildPageButtons(page, totalPages);
      return interaction.update({ embeds: [newEmbed], components: [newRow] });
    } catch (err) {
      return interaction.reply({ content: `❌ Failed to load page: ${err.message}`, ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  // ── Permission check ──
  if (!ALLOWED_ROLE_IDS.some(id => interaction.member.roles.cache.has(id))) {
    await sendWebhook(WEBHOOK_COMMANDS,
      `${timestamp()} 🚫 **${interaction.user.tag}** tried to use \`/${interaction.commandName}\` but lacks permission.`);
    return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
  }

  const cmd      = interaction.commandName;
  const username = interaction.options.getString("username") ?? null;

  // ══════════════════════════════════════════════════
  //  /checkblacklist
  // ══════════════════════════════════════════════════
  if (cmd === "checkblacklist") {
    await interaction.deferReply();
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🔍 **${interaction.user.tag}** ran \`/checkblacklist\``);

    try {
      const kvResponse = await axios.get(
        `${API_URL}/api/blacklist/list`,
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );
      const entries = kvResponse.data?.entries ?? [];

      if (entries.length === 0) {
        return interaction.editReply({ content: "📋 The blacklist is currently empty." });
      }

      const totalPages = Math.ceil(entries.length / PAGE_SIZE);
      const embed      = buildBlacklistEmbed(entries, 0, totalPages);
      const row        = buildPageButtons(0, totalPages);
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Could not fetch blacklist: ${err.message}` });
    }
  }

  // ══════════════════════════════════════════════════
  //  /blacklistinfo <username>
  // ══════════════════════════════════════════════════
  if (cmd === "blacklistinfo") {
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🔍 **${interaction.user.tag}** ran \`/blacklistinfo ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**.`);
    }
    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for **"${username}"** — possible renamed account. Check manually.`);
    }

    try {
      const checkRes = await axios.get(`${API_URL}/api/check/${robloxUser.id}`);
      if (!checkRes.data?.blacklisted) {
        return interaction.editReply(`🟢 **${robloxUser.name}** (\`${robloxUser.id}\`) is **not blacklisted**.`);
      }

      // Fetch full metadata from list endpoint
      const listRes = await axios.get(
        `${API_URL}/api/blacklist/list`,
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );
      const entry = (listRes.data?.entries ?? []).find(e => String(e.robloxId) === String(robloxUser.id));

      const addedAt    = entry?.addedAt ? `<t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:F>` : "Unknown";
      const addedBy    = entry?.discordUsername ?? "Unknown";
      const reason     = entry?.reason ?? "No reason provided";
      const discordId  = entry?.discordId ?? "Unknown";

      const embed = new EmbedBuilder()
        .setTitle(`🔴 Blacklist Info — ${robloxUser.name}`)
        .setColor(0xff0000)
        .addFields(
          { name: "Roblox Username", value: robloxUser.name,          inline: true },
          { name: "Roblox ID",       value: `\`${robloxUser.id}\``,   inline: true },
          { name: "Discord Tag",     value: addedBy,                  inline: true },
          { name: "Discord ID",      value: `\`${discordId}\``,       inline: true },
          { name: "Added At",        value: addedAt,                  inline: true },
          { name: "Reason",          value: reason,                   inline: false }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════
  //  /blacklistreason <username> <reason>
  // ══════════════════════════════════════════════════
  if (cmd === "blacklistreason") {
    const reason = interaction.options.getString("reason");
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 📝 **${interaction.user.tag}** ran \`/blacklistreason ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**.`);
    }
    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for **"${username}"** — mismatch. Check manually.`);
    }

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxUser.id);
    if (!alreadyBlacklisted) {
      return interaction.editReply(`⚠️ **${robloxUser.name}** is not currently blacklisted. Use \`/blacklist\` first.`);
    }

    try {
      await axios.post(
        `${API_URL}/api/blacklist/reason`,
        { robloxId: robloxUser.id, reason },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );
      await sendWebhook(WEBHOOK_COMMANDS,
        `${timestamp()} 📝 Reason updated for **${robloxUser.name}** (\`${robloxUser.id}\`) by **${interaction.user.tag}**: ${reason}`);
      return interaction.editReply(`✅ Reason updated for **${robloxUser.name}**: ${reason}`);
    } catch (err) {
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════
  //  /removebyrobloxid <id>
  // ══════════════════════════════════════════════════
  if (cmd === "removebyrobloxid") {
    const robloxId = interaction.options.getString("id");
    await interaction.deferReply({ ephemeral: true });

    if (!/^\d+$/.test(robloxId)) {
      return interaction.editReply("❌ Invalid ID — digits only.");
    }

    await sendWebhook(WEBHOOK_COMMANDS,
      `${timestamp()} 🔧 **${interaction.user.tag}** ran \`/removebyrobloxid ${robloxId}\``);

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxId);
    if (!alreadyBlacklisted) {
      return interaction.editReply(`⚠️ Roblox ID \`${robloxId}\` is not in the blacklist.`);
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/blacklist/remove`,
        { robloxId },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.success) {
        await sendWebhook(WEBHOOK_COMMANDS,
          `${timestamp()} 🔓 \`/removebyrobloxid\` — ID \`${robloxId}\` removed from blacklist by **${interaction.user.tag}**`);
        await sendWebhook(WEBHOOK_BLACKLIST,
          `${timestamp()} 🔓 Roblox ID \`${robloxId}\` removed from blacklist by **${interaction.user.tag}** via direct ID.`);
        return interaction.editReply(`✅ Roblox ID \`${robloxId}\` removed from the blacklist.`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS,
        `${timestamp()} ❌ \`/removebyrobloxid ${robloxId}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════
  //  /blacklist <username>
  // ══════════════════════════════════════════════════
  if (cmd === "blacklist") {
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🔧 **${interaction.user.tag}** ran \`/blacklist ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/blacklist ${username}\` — Roblox API error: ${err.message}`);
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/blacklist ${username}\` — no Roblox account found.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. No blacklist entry created.`);
    }
    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/blacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for **"${username}"** — names don't match, likely a renamed account. Skipping to avoid blacklisting the wrong person.`);
    }

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxUser.id);
    if (alreadyBlacklisted) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ℹ️ \`/blacklist ${username}\` — already blacklisted, skipped.`);
      return interaction.editReply(`ℹ️ **${robloxUser.name}** is already blacklisted.`);
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/blacklist/add`,
        {
          robloxId: robloxUser.id,
          robloxUsername: robloxUser.name,
          discordId: interaction.user.id,
          discordUsername: interaction.user.tag
        },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.success) {
        await sendWebhook(WEBHOOK_COMMANDS,
          `${timestamp()} ✅ \`/blacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) blacklisted by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Blacklisted **${robloxUser.name}** (${robloxUser.id}).`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/blacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════
  //  /unblacklist <username>
  // ══════════════════════════════════════════════════
  if (cmd === "unblacklist") {
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🔧 **${interaction.user.tag}** ran \`/unblacklist ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/unblacklist ${username}\` — Roblox API error: ${err.message}`);
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/unblacklist ${username}\` — no Roblox account found.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. Nothing removed.`);
    }
    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/unblacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for **"${username}"** — names don't match. Skipping.`);
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/blacklist/remove`,
        { robloxId: robloxUser.id },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.success) {
        await sendWebhook(WEBHOOK_COMMANDS,
          `${timestamp()} 🔓 \`/unblacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) removed by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Removed **${robloxUser.name}** (${robloxUser.id}) from the blacklist.`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/unblacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }
});

client.login(DISCORD_TOKEN);
