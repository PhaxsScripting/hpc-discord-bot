const { Client, GatewayIntentBits, Partials } = require("discord.js");
const axios = require("axios");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;
const API_URL = process.env.API_URL;
const BLACKLIST_ROLE_ID = "1195557302250524764";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

async function getRobloxIdFromUsername(username) {
  const response = await axios.post(
    "https://users.roblox.com/v1/usernames/users",
    { usernames: [username], excludeBannedUsers: false },
    { headers: { "Content-Type": "application/json" } }
  );
  const match = response.data?.data?.[0];
  return match ? { id: match.id, name: match.name } : null;
}

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      console.log(`[Bot] Cached members for guild: ${guild.name}`);
    } catch (err) {
      console.error(`[Bot] Failed to cache members for ${guild.name}:`, err.message);
    }
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  console.log(`[Bot] guildMemberUpdate fired for ${newMember.user.tag}`);

  const hadRole = oldMember.roles.cache.has(BLACKLIST_ROLE_ID);
  const hasRole = newMember.roles.cache.has(BLACKLIST_ROLE_ID);
  if (hadRole || !hasRole) return;

  const displayName = newMember.displayName;
  console.log(`[Bot] Blacklist role given to ${newMember.user.tag} (display: ${displayName})`);

  try {
    const robloxUser = await getRobloxIdFromUsername(displayName);
    if (!robloxUser) {
      console.error(`[Bot] No Roblox user found for username "${displayName}"`);
      return;
    }

    const response = await axios.post(
      `${API_URL}/api/blacklist/add`,
      {
        robloxId: robloxUser.id,
        robloxUsername: robloxUser.name,
        discordId: newMember.id,
        discordUsername: newMember.user.tag
      },
      { headers: { "Authorization": `Bearer ${BOT_SECRET}` } }
    );

    if (response.data.success) {
      console.log(`[Bot] Blacklisted Roblox user ${robloxUser.name} (${robloxUser.id}) — flagged via ${displayName}`);
    }
  } catch (error) {
    console.error(`[Bot] Error processing blacklist for ${displayName}:`, error.message);
  }
});

client.login(DISCORD_TOKEN);
