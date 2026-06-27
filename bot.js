const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const axios = require("axios");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;
const API_URL = process.env.API_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const BLACKLIST_ROLE_ID = "1195557302250524764";
const ALLOWED_ROLE_IDS = [
  "1390336483277144064",
  "1398071632207151184",
  "1422406753231966290",
  "1398071208343244870"
];

const WEBHOOK_COMMANDS = "https://discord.com/api/webhooks/1520230687049908364/FANxy6d9H3yukPf2lis6ZnDHS_3VN9m1aUGao3ofeEGdcFtzZ0LQ3sIkF5n1oC-at57p";
const WEBHOOK_BLACKLIST = "https://discord.com/api/webhooks/1520233138767265922/YZGiw-27WhGD3HQxWDGJTvzFf9q_-dzxqPawAqdOqAC6-YmCH-ZBLlPYm_ju8y5QU20u";

const PAGE_SIZE = 10;

function timestamp() {
  return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

async function sendWebhook(url, content) {
  try {
    await axios.post(url, { content }, { headers: { "Content-Type": "application/json" } });
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

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
  const displayName = member.displayName;
  const robloxUsername = extractRobloxUsername(displayName);
  const robloxUser = await getRobloxIdFromUsername(robloxUsername);

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

async function addBlacklistCandidate(member, fromStartup = false) {
  console.log(`[Bot] Adding blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — no blacklist entry created.`);
      return;
    }

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxUser.id);
    if (alreadyBlacklisted) {
      if (!fromStartup) {
        await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ℹ️ **${robloxUser.name}** (\`${robloxUser.id}\`) is already blacklisted — skipped.`);
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
      await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ✅ Blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role given to ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error adding blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ❌ Error blacklisting **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

async function removeBlacklistCandidate(member) {
  console.log(`[Bot] Removing blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — nothing removed.`);
      return;
    }

    const response = await axios.post(
      `${API_URL}/api/blacklist/remove`,
      { robloxId: robloxUser.id },
      { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
    );

    if (response.data.success) {
      console.log(`[Bot] Un-blacklisted ${robloxUser.name} (${robloxUser.id}) — role removed from ${member.displayName}`);
      await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} 🔓 Un-blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role removed from ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error removing blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST, `${timestamp()} ❌ Error removing blacklist for **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

function buildBlacklistEmbed(entries, page, totalPages) {
  const start = page * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);

  const description = pageEntries.map((entry, i) => {
    const num = start + i + 1;
    const robloxName = entry.robloxUsername || "Unknown";
    const robloxId = entry.robloxId || "Unknown";
    const discordName = entry.discordUsername || "Unknown";
    return `**${num}.** ${robloxName} (\`${robloxId}\`)\n　Discord: ${discordName}`;
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

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);

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
        .setDescription("Remove a Roblox user from the blacklist")
        .addStringOption(opt =>
          opt.setName("username").setDescription("Roblox username").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("checkblacklist")
        .setDescription("Show all currently blacklisted users")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("[Bot] Commands force updated");
    console.log("[Bot] Slash commands registered");
  } catch (err) {
    console.error("[Bot] Failed to register slash commands:", err.message);
  }

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
});

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

client.on("interactionCreate", async (interaction) => {
  // Handle pagination buttons
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith("bl_")) return;

    const message = interaction.message;
    const embed = message.embeds[0];
    if (!embed) return;

    const footerMatch = embed.footer?.text?.match(/Page (\d+) of (\d+)/);
    if (!footerMatch) return;

    let page = parseInt(footerMatch[1]) - 1;
    const totalPages = parseInt(footerMatch[2]);

    if (interaction.customId === "bl_prev") page = Math.max(0, page - 1);
    if (interaction.customId === "bl_next") page = Math.min(totalPages - 1, page + 1);

    try {
      const kvResponse = await axios.get(
        `${API_URL}/api/blacklist/list`,
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );
      const entries = kvResponse.data?.entries ?? [];
      const newEmbed = buildBlacklistEmbed(entries, page, totalPages);
      const newRow = buildPageButtons(page, totalPages);
      return interaction.update({ embeds: [newEmbed], components: [newRow] });
    } catch (err) {
      return interaction.reply({ content: `❌ Failed to load page: ${err.message}`, ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (!ALLOWED_ROLE_IDS.some(id => interaction.member.roles.cache.has(id))) {
    await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🚫 **${interaction.user.tag}** tried to use \`/${interaction.commandName}\` but lacks permission.`);
    return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
  }

  const username = interaction.options.getString("username");

  if (interaction.commandName === "checkblacklist") {
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
      const embed = buildBlacklistEmbed(entries, 0, totalPages);
      const row = buildPageButtons(0, totalPages);
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Could not fetch blacklist: ${err.message}` });
    }
  }

  if (interaction.commandName === "blacklist") {
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
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/blacklist ${username}\` — no Roblox account found, no entry created.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. No blacklist entry created.`);
    }

    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/blacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for query **"${username}"** — names don't match, likely a renamed account. Skipping to avoid blacklisting the wrong person. Check manually.`);
    }

    const alreadyBlacklisted = await isAlreadyBlacklisted(robloxUser.id);
    if (alreadyBlacklisted) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ℹ️ \`/blacklist ${username}\` — **${robloxUser.name}** is already blacklisted, skipped.`);
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
        await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ✅ \`/blacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) blacklisted by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Blacklisted **${robloxUser.name}** (${robloxUser.id}).`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/blacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  if (interaction.commandName === "unblacklist") {
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
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/unblacklist ${username}\` — no Roblox account found, nothing removed.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. Nothing removed.`);
    }

    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ⚠️ \`/unblacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for query **"${username}"** — names don't match. Skipping to avoid removing the wrong person.`);
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/blacklist/remove`,
        { robloxId: robloxUser.id },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.success) {
        await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} 🔓 \`/unblacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) removed by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Removed **${robloxUser.name}** (${robloxUser.id}) from the blacklist.`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `${timestamp()} ❌ \`/unblacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }
});

client.login(DISCORD_TOKEN);
