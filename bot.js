const { Client, GatewayIntentBits, Partials } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildBans], partials: [Partials.User] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    // Register the slash command globally
    client.application.commands.create({
        name: 'unbanusers',
        description: 'Unban all banned users and send them an apology DM',
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'unbanusers') {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: 'This command can only be used in a server.' });
            return;
        }

        try {
            const bans = await guild.bans.fetch();
            if (bans.size === 0) {
                await interaction.editReply({ content: 'No banned users found.' });
                return;
            }

            let count = 0;
            for (const [userId, ban] of bans) {
                try {
                    await guild.members.unban(userId);
                    count++;

                    // Try to send a DM
                    const user = await client.users.fetch(userId);
                    try {
                        await user.send("I'm sorry for the inconvience, I (Phax) took a bad decision and banned a lot of users for no reason.  Please excuse my decision and take the time to join back at https://discord.gg/UXntxJGjU");
                    } catch (dmError) {
                        console.log(`Could not send DM to user ${userId}: ${dmError.message}`);
                    }

                    // Wait for 1 second between each unban to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (unbanError) {
                    console.log(`Failed to unban user ${userId}: ${unbanError.message}`);
                }
            }

            await interaction.editReply({ content: `Successfully unbanned ${count} user(s).` });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'An error occurred while unbanning users.' });
        }
    }
});

client.login(process.env.TOKEN);
