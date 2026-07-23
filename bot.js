const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

const { PlayFabServer } = require('playfab-sdk'); // Server API
const fetch = require('node-fetch');

const TOKEN = process.env.TOKEN;                                   // Discord bot token
const PLAYFAB_TITLE_ID = process.env.PLAYFAB_TITLE_ID;             // PlayFab Title ID
const PLAYFAB_DEV_SECRET_KEY = process.env.PLAYFAB_DEV_SECRET_KEY; // Secret key for Server API
// const TARGET_GUILD_ID = '1403264230328766496'; // Disabled for global commands                     // Only this guild may use the bot
const PLAYFAB_MANAGER_ROLE_ID = '1528185829439180800';             // Role allowed to run manager commands
const LOG_WEBHOOK_URL =
  process.env.LOG_WEBHOOK_URL ||
  'https://discord.com/api/webhooks/1529789372096970912/gz73gdDOOOxz_aW_cvosC4sO3j7IPLc6bQtARSnanpRo3bvROO0e_oJ0eQo5_7BN2JDO';


if (!TOKEN || !PLAYFAB_TITLE_ID || !PLAYFAB_DEV_SECRET_KEY) {
  console.error('Missing required environment variables: TOKEN, PLAYFAB_TITLE_ID, PLAYFAB_DEV_SECRET_KEY');
  process.exit(1);
}

PlayFabServer.settings.titleId = PLAYFAB_TITLE_ID;
PlayFabServer.settings.developerSecretKey = PLAYFAB_DEV_SECRET_KEY;

async function logToWebhook(content) {
  try {
    await fetch(LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (e) {
    console.error('Failed to send log to webhook:', e);
  }
}

function assertGuildOnly(interaction) {
  return true; // Always allow (guild restriction removed)
}

function assertManagerOnly(interaction) {
  return Boolean(interaction.member && interaction.member.roles.cache.has(PLAYFAB_MANAGER_ROLE_ID));
}

async function resolvePlayerIdentifier(input) {
  const trimmed = input.trim();

  if (/^[A-Za-z0-9]{10,}$/.test(trimmed)) {
    try {
      const res = await PlayFabServer.GetPlayerProfile({
        PlayFabId: trimmed,
        ProfileConstraints: { ShowDisplayName: true, ShowAvatarUrl: true }
      }).promise();
      if (res.data.PlayerProfile) {
        return { type: 'single', playFabId: trimmed };
      }
    } catch (_) {
      // fall back
    }
  }

  try {
    const all = await PlayFabServer.GetPlayerProfiles({}).promise();
    const profiles = all.data.PlayerProfiles || [];
    const matches = profiles
      .filter(p => p.DisplayName && p.DisplayName.toLowerCase() === trimmed.toLowerCase())
      .map(p => ({ id: p.PlayFabId, name: p.DisplayName }));

    if (matches.length === 0) return { type: 'none' };
    if (matches.length === 1) return { type: 'single', playFabId: matches[0].id };
    return { type: 'multiple', matches };
  } catch (e) {
    console.error('Error while resolving player identifier:', e);
    return { type: 'none' };
  }
}

async function getDisplayName(playFabId) {
  try {
    const res = await PlayFabServer.GetPlayerProfile({
      PlayFabId: playFabId,
      ProfileConstraints: { ShowDisplayName: true }
    }).promise();
    return (res.data.PlayerProfile && res.data.PlayerProfile.DisplayName) || playFabId;
  } catch (_) {
    return playFabId;
  }
}

function buildConfirmationEmbed(action, targetInfo, extraFields = []) {
  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle(`PlayFab ${action} Confirmation`)
    .setDescription(`Are you sure you want to **${action.toLowerCase()}** the following player?`)
    .addFields(
      { name: 'Player', value: `**${targetInfo.name}**\nID: \`${targetInfo.id}\``, inline: true },
      ...extraFields
    )
    .setTimestamp()
    .setFooter({ text: 'PlayFab Manager Bot' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_yes').setLabel('Yes, do it').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );

  return { embed, row };
}

function buildSelectMenu(customId, matches) {
  const options = matches.slice(0, 25).map(m =>
    new StringSelectMenuOptionBuilder()
      .setLabel(m.name || m.id)
      .setDescription(`ID: ${m.id}`)
      .setValue(m.id)
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select the exact player...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function buildMultiMatchEmbed(color, input) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle('Multiple matches found')
    .setDescription(`More than one player matches "${input}". Please select the correct one from the menu below.`)
    .setFooter({ text: 'PlayFab Manager Bot' });
}

const pendingActions = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function setPending(userId, data) {
  pendingActions.set(userId, { ...data, timestamp: Date.now() });
}

function getPending(userId) {
  const data = pendingActions.get(userId);
  if (!data) return null;
  if (Date.now() - data.timestamp > PENDING_TTL_MS) {
    pendingActions.delete(userId);
    return null;
  }
  return data;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.User, Partials.GuildMember]
});

const MANAGER_COMMANDS = [
  'grantcosmetic',
  'grantcurrency',
  'banplayer',
  'unbanplayer',
  'viewplayerinventory',
  'ipbanuser',
  'viewdlc',
  'viewuserprofile'
];

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    {
      name: 'grantcosmetic',
      description: 'Grant a cosmetic or bundle to a player (PlayFab Manager only)',
      options: [
        { name: 'target', description: 'PlayFab ID or display name', type: 3, required: true },
        { name: 'item', description: 'Cosmetic or bundle item ID', type: 3, required: true }
      ]
    },
    {
      name: 'grantcurrency',
      description: 'Grant SR currency to a player (PlayFab Manager only)',
      options: [
        { name: 'target', description: 'PlayFab ID or display name', type: 3, required: true },
        { name: 'amount', description: 'Amount of SR to grant', type: 4, required: true }
      ]
    },
    {
      name: 'banplayer',
      description: 'Ban a player from PlayFab (PlayFab Manager only)',
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    },
    {
      name: 'unbanplayer',
      description: 'Unban a player from PlayFab (PlayFab Manager only)',
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    },
    {
      name: 'viewplayerinventory',
      description: "View a player's cosmetic inventory (PlayFab Manager only)",
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    },
    {
      name: 'ipbanuser',
      description: 'Ban a player and flag it as an IP ban (PlayFab Manager only)',
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    },
    {
      name: 'viewdlc',
      description: 'List current PlayFab DLC / bundles (PlayFab Manager only)'
    },
    {
      name: 'viewuserprofile',
      description: "View a player's full PlayFab profile (PlayFab Manager only)",
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    },
    {
      name: 'viewcurrency',
      description: "View a player's SR currency",
      options: [{ name: 'target', description: 'PlayFab ID or display name', type: 3, required: true }]
    }
  ];

  try {
    await client.application.commands.set(commands);
    console.log('Slash commands registered globally.');
  } catch (e) {
    console.error('Failed to register slash commands:', e);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!assertGuildOnly(interaction)) {
    return interaction.reply({ content: 'This bot can only be used in the official server.', ephemeral: true });
  }

  const isManagerCmd = MANAGER_COMMANDS.includes(interaction.commandName);
  if (isManagerCmd && !assertManagerOnly(interaction)) {
    return interaction.reply({
      content: 'You do not have the PlayFab Manager role required to run this command.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    switch (interaction.commandName) {
      case 'grantcosmetic': {
        const targetInput = interaction.options.getString('target', true);
        const itemId = interaction.options.getString('item', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`grantcosmetic failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'grantcosmetic', params: { itemId } });
          const row = buildSelectMenu('select_player_for_grantcosmetic', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xf1c40f, targetInput)], components: [row] });
          await logToWebhook(`grantcosmetic - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'grantcosmetic', params: { itemId }, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('Grant Cosmetic', targetInfo, [
          { name: 'Item/Bundle ID', value: `\`${itemId}\``, inline: true }
        ]);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`grantcosmetic - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'grantcurrency': {
        const targetInput = interaction.options.getString('target', true);
        const amount = interaction.options.getInteger('amount', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`grantcurrency failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'grantcurrency', params: { amount } });
          const row = buildSelectMenu('select_player_for_grantcurrency', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xf1c40f, targetInput)], components: [row] });
          await logToWebhook(`grantcurrency - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'grantcurrency', params: { amount }, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('Grant Currency', targetInfo, [
          { name: 'Amount (SR)', value: `\`${amount}\``, inline: true }
        ]);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`grantcurrency - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'banplayer': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`banplayer failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'banplayer', params: {} });
          const row = buildSelectMenu('select_player_for_banplayer', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xe74c3c, targetInput)], components: [row] });
          await logToWebhook(`banplayer - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'banplayer', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('Ban Player', targetInfo);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`banplayer - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'unbanplayer': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`unbanplayer failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'unbanplayer', params: {} });
          const row = buildSelectMenu('select_player_for_unbanplayer', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0x2ecc71, targetInput)], components: [row] });
          await logToWebhook(`unbanplayer - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'unbanplayer', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('Unban Player', targetInfo);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`unbanplayer - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'viewplayerinventory': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`viewplayerinventory failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'viewplayerinventory', params: {} });
          const row = buildSelectMenu('select_player_for_viewinventory', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xf1c40f, targetInput)], components: [row] });
          await logToWebhook(`viewplayerinventory - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'viewplayerinventory', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('View Inventory', targetInfo);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`viewplayerinventory - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'ipbanuser': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`ipbanuser failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'ipbanuser', params: {} });
          const row = buildSelectMenu('select_player_for_ipbanuser', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0x8e44ad, targetInput)], components: [row] });
          await logToWebhook(`ipbanuser - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'ipbanuser', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('IP Ban Player', targetInfo, [
          { name: 'Note', value: 'This ban is flagged as an IP ban; actual IP-level blocking must be handled server-side.', inline: false }
        ]);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`ipbanuser - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'viewdlc': {
        const catalogRes = await PlayFabServer.GetCatalogItems({}).promise();
        const catalog = catalogRes.data.Catalog || [];
        const dlcItems = catalog.filter(
          it => (it.Tags && it.Tags.includes('DLC')) || (it.Category && it.Category.toLowerCase() === 'bundle')
        );

        if (dlcItems.length === 0) {
          await interaction.editReply({ content: 'No DLC items found in the catalog.' });
          await logToWebhook(`viewdlc - no DLC items found (by <@${interaction.user.id}>)`);
          return;
        }

        const desc = dlcItems.map(it => `- **${it.ItemId}** - ${it.DisplayName || '(no name)'}`).join('\n');
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('Current PlayFab DLC / Bundles')
          .setDescription(desc)
          .setTimestamp()
          .setFooter({ text: 'PlayFab Manager Bot' });

        await interaction.editReply({ embeds: [embed] });
        await logToWebhook(`viewdlc - listed DLC (by <@${interaction.user.id}>)`);
        break;
      }

      case 'viewuserprofile': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`viewuserprofile failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'viewuserprofile', params: {} });
          const row = buildSelectMenu('select_player_for_viewprofile', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xf1c40f, targetInput)], components: [row] });
          await logToWebhook(`viewuserprofile - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'viewuserprofile', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('View Profile', targetInfo);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`viewuserprofile - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      case 'viewcurrency': {
        const targetInput = interaction.options.getString('target', true);

        const resolved = await resolvePlayerIdentifier(targetInput);
        if (resolved.type === 'none') {
          await interaction.editReply({ content: `No PlayFab player found matching \`${targetInput}\`.` });
          await logToWebhook(`viewcurrency failed - no player matched "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }
        if (resolved.type === 'multiple') {
          setPending(interaction.user.id, { command: 'viewcurrency', params: {} });
          const row = buildSelectMenu('select_player_for_viewcurrency', resolved.matches);
          await interaction.editReply({ embeds: [buildMultiMatchEmbed(0xf39c12, targetInput)], components: [row] });
          await logToWebhook(`viewcurrency - multiple matches for "${targetInput}" (by <@${interaction.user.id}>)`);
          return;
        }

        const targetInfo = { id: resolved.playFabId, name: await getDisplayName(resolved.playFabId) };
        setPending(interaction.user.id, { command: 'viewcurrency', params: {}, targetId: resolved.playFabId });
        const { embed, row } = buildConfirmationEmbed('View Currency', targetInfo);
        await interaction.editReply({ embeds: [embed], components: [row] });
        await logToWebhook(`viewcurrency - awaiting confirmation for \`${resolved.playFabId}\` (by <@${interaction.user.id}>)`);
        break;
      }

      default:
        await interaction.editReply({ content: 'Unknown command.' });
        return;
    }
  } catch (err) {
    console.error('Error while processing command:', err);
    await interaction.editReply({ content: 'An unexpected error occurred while processing the command.' });
    await logToWebhook(`Error in command ${interaction.commandName} (by <@${interaction.user.id}>): ${err.message}`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
  // if (interaction.guildId !== TARGET_GUILD_ID) return; // Guild restriction removed

  const isManager = assertManagerOnly(interaction);
  const isManagedComponent =
    (interaction.customId && interaction.customId.startsWith('select_player_for_')) ||
    interaction.customId === 'confirm_yes' ||
    interaction.customId === 'cancel' ||
    interaction.customId === 'inv_prev' ||
    interaction.customId === 'inv_next';

  const pending = getPending(interaction.user.id);
  const isViewCurrencyFlow = pending && pending.command === 'viewcurrency';

  if (isManagedComponent && !isManager && !isViewCurrencyFlow) {
    return interaction.reply({ content: 'You do not have permission to use this component.', ephemeral: true });
  }

  if (!pending) {
    return interaction.reply({ content: 'No pending action found. Please run the command again.', ephemeral: true });
  }

  if (interaction.isStringSelectMenu()) {
    const selectedId = interaction.values[0];
    pending.targetId = selectedId;
    setPending(interaction.user.id, pending);

    try {
      const name = await getDisplayName(selectedId);
      const targetInfo = { id: selectedId, name };

      let actionName = pending.command;
      let extraFields = [];

      switch (pending.command) {
        case 'grantcosmetic':
          actionName = 'Grant Cosmetic';
          extraFields = [{ name: 'Item/Bundle ID', value: `\`${pending.params.itemId}\``, inline: true }];
          break;
        case 'grantcurrency':
          actionName = 'Grant Currency';
          extraFields = [{ name: 'Amount (SR)', value: `\`${pending.params.amount}\``, inline: true }];
          break;
        case 'banplayer':
          actionName = 'Ban Player';
          break;
        case 'unbanplayer':
          actionName = 'Unban Player';
          break;
        case 'viewplayerinventory':
          actionName = 'View Inventory';
          break;
        case 'ipbanuser':
          actionName = 'IP Ban Player';
          extraFields = [{ name: 'Note', value: 'This ban is flagged as an IP ban; actual IP-level blocking must be handled server-side.', inline: false }];
          break;
        case 'viewuserprofile':
          actionName = 'View Profile';
          break;
        case 'viewcurrency':
          actionName = 'View Currency';
          break;
      }

      const { embed, row } = buildConfirmationEmbed(actionName, targetInfo, extraFields);
      await interaction.update({ embeds: [embed], components: [row] });
      await logToWebhook(`${pending.command} - player selected \`${selectedId}\` (by <@${interaction.user.id}>). Awaiting confirmation.`);
    } catch (e) {
      console.error('Error fetching profile for selected ID:', e);
      await interaction.reply({ content: 'Failed to fetch player data. Please try again.', ephemeral: true });
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'cancel') {
      pendingActions.delete(interaction.user.id);
      await interaction.update({ content: 'Action cancelled.', embeds: [], components: [] });
      await logToWebhook(`${pending.command} cancelled by <@${interaction.user.id}>.`);
      return;
    }

    if (interaction.customId === 'confirm_yes') {
      const { command, params, targetId } = pending;
      pendingActions.delete(interaction.user.id);

      if (!targetId) {
        await interaction.update({ content: 'No target player selected. Please run the command again.', embeds: [], components: [] });
        return;
      }

      try {
        let resultMsg = '';

        switch (command) {
          case 'grantcosmetic':
            await PlayFabServer.GrantItemsToUser({ PlayFabId: targetId, ItemIds: [params.itemId] }).promise();
            resultMsg = `Granted item \`${params.itemId}\` to player \`${targetId}\`.`;
            break;

          case 'grantcurrency':
            await PlayFabServer.AddUserVirtualCurrency({
              PlayFabId: targetId,
              VirtualCurrency: 'SR',
              Amount: params.amount
            }).promise();
            resultMsg = `Granted ${params.amount} SR to player \`${targetId}\`.`;
            break;

          case 'banplayer':
            await PlayFabServer.BanUsers({
              Bans: [{ PlayFabId: targetId, Reason: 'Banned via Discord PlayFab Manager bot', DurationInHours: 0 }]
            }).promise();
            resultMsg = `Banned player \`${targetId}\`.`;
            break;

          case 'unbanplayer':
            await PlayFabServer.RevokeAllBansForUser({ PlayFabId: targetId }).promise();
            resultMsg = `Unbanned player \`${targetId}\`.`;
            break;

          case 'viewplayerinventory': {
            const invRes = await PlayFabServer.GetUserInventory({ PlayFabId: targetId }).promise();
            const items = invRes.data.Inventory || [];
            if (items.length === 0) {
              resultMsg = `Player \`${targetId}\` has no items in inventory.`;
              break;
            }

            const ITEMS_PER_PAGE = 10;
            const maxPage = Math.ceil(items.length / ITEMS_PER_PAGE) - 1;

            function buildPage(p) {
              const start = p * ITEMS_PER_PAGE;
              const slice = items.slice(start, start + ITEMS_PER_PAGE);
              const desc =
                slice.map((it, idx) => `${start + idx + 1}. **${it.ItemId}** (x${it.RemainingUses || 1})`).join('\n') || '(none)';
              return new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle(`Inventory of \`${targetId}\` (Page ${p + 1}/${maxPage + 1})`)
                .setDescription(desc)
                .setFooter({ text: 'Use the buttons to navigate pages' });
            }

            const navRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('inv_prev').setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(true),
              new ButtonBuilder().setCustomId('inv_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(maxPage <= 0)
            );

            await interaction.update({ embeds: [buildPage(0)], components: [navRow] });
            await logToWebhook(`viewplayerinventory - viewed inventory of \`${targetId}\` (by <@${interaction.user.id}>)`);
            return;
          }

          case 'ipbanuser':
            await PlayFabServer.BanUsers({
              Bans: [{ PlayFabId: targetId, Reason: 'IP ban requested via Discord PlayFab Manager bot', DurationInHours: 0 }]
            }).promise();
            resultMsg = `IP-banned player \`${targetId}\` (user banned; IP-level blocking must be handled server-side).`;
            break;

          case 'viewuserprofile': {
            const profileRes = await PlayFabServer.GetPlayerProfile({
              PlayFabId: targetId,
              ProfileConstraints: {
                ShowDisplayName: true,
                ShowAvatarUrl: true,
                ShowCreated: true,
                ShowLastLogin: true,
                ShowStatistics: true,
                ShowVirtualCurrencyBalances: true
              }
            }).promise();
            const pf = profileRes.data.PlayerProfile;
            if (!pf) {
              resultMsg = `Could not retrieve profile for \`${targetId}\`.`;
              break;
            }

            const embed = new EmbedBuilder()
              .setColor(0x1abc9c)
              .setTitle(`Profile of ${pf.DisplayName || '(no name)'}`)
              .setThumbnail(pf.AvatarUrl || null)
              .addFields(
                { name: 'PlayFab ID', value: `\`${pf.PlayerId}\``, inline: true },
                { name: 'Created', value: pf.Created ? `<t:${Math.floor(new Date(pf.Created).getTime() / 1000)}:F>` : 'Unknown', inline: true },
                { name: 'Last Login', value: pf.LastLogin ? `<t:${Math.floor(new Date(pf.LastLogin).getTime() / 1000)}:R>` : 'Never', inline: true },
                { name: 'SR Currency', value: ((pf.VirtualCurrencyBalances && pf.VirtualCurrencyBalances.SR) || 0).toString(), inline: true }
              )
              .setTimestamp()
              .setFooter({ text: 'PlayFab Manager Bot' });

            await interaction.update({ embeds: [embed], components: [] });
            await logToWebhook(`viewuserprofile - viewed profile of \`${targetId}\` (by <@${interaction.user.id}>)`);
            return;
          }

          case 'viewcurrency': {
            const profileRes = await PlayFabServer.GetPlayerProfile({
              PlayFabId: targetId,
              ProfileConstraints: { ShowVirtualCurrencyBalances: true }
            }).promise();
            const amount =
              (profileRes.data.PlayerProfile &&
                profileRes.data.PlayerProfile.VirtualCurrencyBalances &&
                profileRes.data.PlayerProfile.VirtualCurrencyBalances.SR) ||
              0;
            resultMsg = `Player \`${targetId}\` has ${amount} SR.`;
            break;
          }

          default:
            resultMsg = 'Unknown command.';
        }

        await interaction.update({ content: resultMsg, embeds: [], components: [] });
        await logToWebhook(`${command} executed on \`${targetId}\` (by <@${interaction.user.id}>)`);
      } catch (err) {
        console.error('Error executing PlayFab action:', err);
        await interaction.update({
          content: `An error occurred while executing the action: ${err.message}`,
          embeds: [],
          components: []
        });
        await logToWebhook(`Error executing ${command} on \`${targetId}\` (by <@${interaction.user.id}>): ${err.message}`);
      }
      return;
    }
  }
});

client.login(TOKEN);

