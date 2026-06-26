const { Client, GatewayIntentBits, Partitions } = require("discord.js");
const axios = require("axios");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;      // Must match Railway variable
const API_URL = process.env.API_URL;            // Your Vercel backend URL
const BLACKLIST_ROLE_ID = "1195557302250524764"; 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,  
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partitions.GuildMember]
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const hadRole = oldMember.roles.cache.has(BLACKLIST_ROLE_ID);
  const hasRole = newMember.roles.cache.has(BLACKLIST_ROLE_ID);

  if (!hadRole && hasRole) {
    const displayName = newMember.displayName; // Nickname if set, else username
    console.log(`[Bot] Blacklist role given to ${newMember.user.tag} (display: ${displayName})`);

    try {
      const response = await axios.get(
        `${API_URL}/api/check/${encodeURIComponent(displayName)}`,
        {
          headers: { "Authorization": `Bearer ${BOT_SECRET}` }
        }
      );

      if (response.data.blacklisted) {
        await newMember.kick("Blacklisted user detected (via Roblox ban)");
        console.log(`[Bot] KICKED ${displayName} (blacklisted Roblox user)`);
      } else {
        console.log(`[Bot] ${displayName} is NOT blacklisted → taking no action`);
      }
    } catch (error) {
      console.error(`[Bot] API call failed:`, error.message);
    }
  }
});

client.once("ready", () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
