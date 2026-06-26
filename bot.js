const { Client, GatewayIntentBits, Partials } = require("discord.js"); // ← FIXED: Partials (not Partitions)
const axios = require("axios");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;      // Must match Railway variable
const API_URL = process.env.API_URL;            // Your Vercel backend URL
const BLACKLIST_ROLE_ID = "REPLACE_WITH_YOUR_ROLE_ID"; // ← VERIFY THIS IS YOUR ACTUAL ROLE ID!

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember] // ← FIXED: Partials (not Partitions)
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const hadRole = oldMember.roles.cache.has(BLACKLIST_ROLE_ID);
  const hasRole = newMember.roles.cache.has(BLACKLIST_ROLE_ID);

  if (!hadRole && hasRole) {
    const displayName = newMember.displayName;
    console.log(`[Bot] Blacklist role given to ${newMember.user.tag} (display: ${displayName})`);

    try {
      const response = await axios.get(
        `${API_URL}/api/check/${encodeURIComponent(displayName)}`,
        { headers: { "Authorization": `Bearer ${BOT_SECRET}` } }
      );

      if (response.data.blacklisted) {
        await newMember.kick("Blacklisted user detected");
        console.log(`[Bot] KICKED ${displayName} (blacklisted)`);
      } else {
        console.log(`[Bot] ${displayName} is NOT blacklisted`);
      }
    } catch (error) {
      console.error(`[Bot] API error:`, error.message);
    }
  }
});

client.once("ready", () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
