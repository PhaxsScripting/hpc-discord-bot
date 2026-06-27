const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require("discord.js");
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

async function sendWebhook(url, content) {
  try {
    await axios.post(url, { content }, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[Bot] Webhook send failed:`, err.message);
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

async function addBlacklistCandidate(member) {
  console.log(`[Bot] Adding blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST, `⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — no blacklist entry created.`);
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
      await sendWebhook(WEBHOOK_BLACKLIST, `✅ Blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role given to ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error adding blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST, `❌ Error blacklisting **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

async function removeBlacklistCandidate(member) {
  console.log(`[Bot] Removing blacklist candidate: ${member.user.tag} (display: ${member.displayName})`);
  try {
    const robloxUser = await resolveRobloxUser(member);
    if (!robloxUser) {
      await sendWebhook(WEBHOOK_BLACKLIST, `⚠️ Could not resolve Roblox user for **${member.user.tag}** (display: \`${member.displayName}\`) — nothing removed.`);
      return;
    }

    const response = await axios.post(
      `${API_URL}/api/blacklist/remove`,
      { robloxId: robloxUser.id },
      { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
    );

    if (response.data.success) {
      console.log(`[Bot] Un-blacklisted ${robloxUser.name} (${robloxUser.id}) — role removed from ${member.displayName}`);
      await sendWebhook(WEBHOOK_BLACKLIST, `🔓 Un-blacklisted **${robloxUser.name}** (\`${robloxUser.id}\`) — role removed from ${member.user.tag} (\`${member.displayName}\`)`);
    }
  } catch (error) {
    console.error(`[Bot] Error removing blacklist for ${member.displayName}:`, error.message);
    await sendWebhook(WEBHOOK_BLACKLIST, `❌ Error removing blacklist for **${member.user.tag}** (\`${member.displayName}\`): ${error.message}`);
  }
}

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);

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
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("[Bot] Slash commands registered");

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
        await addBlacklistCandidate(member);
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
  if (!interaction.isChatInputCommand()) return;

  if (!ALLOWED_ROLE_IDS.some(id => interaction.member.roles.cache.has(id))) {
    await sendWebhook(WEBHOOK_COMMANDS, `🚫 **${interaction.user.tag}** tried to use \`/${interaction.commandName}\` but lacks permission.`);
    return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
  }

  const username = interaction.options.getString("username");

  if (interaction.commandName === "blacklist") {
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `🔧 **${interaction.user.tag}** ran \`/blacklist ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `❌ \`/blacklist ${username}\` — Roblox API error: ${err.message}`);
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      await sendWebhook(WEBHOOK_COMMANDS, `⚠️ \`/blacklist ${username}\` — no Roblox account found, no entry created.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. No blacklist entry created.`);
    }

    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `⚠️ \`/blacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for query **"${username}"** — names don't match, likely a renamed account. Skipping to avoid blacklisting the wrong person. Check manually.`);
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
        await sendWebhook(WEBHOOK_COMMANDS, `✅ \`/blacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) blacklisted by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Blacklisted **${robloxUser.name}** (${robloxUser.id}).`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `❌ \`/blacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }

  if (interaction.commandName === "unblacklist") {
    await interaction.deferReply({ ephemeral: true });
    await sendWebhook(WEBHOOK_COMMANDS, `🔧 **${interaction.user.tag}** ran \`/unblacklist ${username}\``);

    let robloxUser;
    try {
      robloxUser = await getRobloxIdFromUsername(username);
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `❌ \`/unblacklist ${username}\` — Roblox API error: ${err.message}`);
      return interaction.editReply(`❌ Roblox API error: ${err.message}`);
    }

    if (!robloxUser) {
      await sendWebhook(WEBHOOK_COMMANDS, `⚠️ \`/unblacklist ${username}\` — no Roblox account found, nothing removed.`);
      return interaction.editReply(`⚠️ Could not find a Roblox account for **"${username}"**. Nothing removed.`);
    }

    if (robloxUser.name.toLowerCase() !== username.toLowerCase()) {
      await sendWebhook(WEBHOOK_COMMANDS, `⚠️ \`/unblacklist ${username}\` — mismatch, Roblox returned **${robloxUser.name}**. Skipped.`);
      return interaction.editReply(`⚠️ Roblox returned **${robloxUser.name}** for query **"${username}"** — names don't match. Skipping to avoid removing the wrong person.`);
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/blacklist/remove`,
        { robloxId: robloxUser.id },
        { headers: { Authorization: `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.success) {
        await sendWebhook(WEBHOOK_COMMANDS, `🔓 \`/unblacklist\` — **${robloxUser.name}** (\`${robloxUser.id}\`) removed by **${interaction.user.tag}**`);
        return interaction.editReply(`✅ Removed **${robloxUser.name}** (${robloxUser.id}) from the blacklist.`);
      }
    } catch (err) {
      await sendWebhook(WEBHOOK_COMMANDS, `❌ \`/unblacklist ${username}\` — backend error: ${err.message}`);
      return interaction.editReply(`❌ Backend error: ${err.message}`);
    }
  }
});

client.login(DISCORD_TOKEN);
