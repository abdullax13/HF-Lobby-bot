const {
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const MAX_PLAYERS = 5;

function lobbyKey(id) { return `lobby:${id}`; }
function pendingKey(id) { return `pending:${id}`; }
function cfgKey(k) { return `cfg:${k}`; }

function isFull(l) { return (l.members?.length ?? 0) >= MAX_PLAYERS; }
function stateEmoji(l) { return (l.locked || isFull(l)) ? "🔴" : "🟢"; }

async function registerCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد نظام اللوبي")
    .addChannelOption(o =>
      o.setName("panel").setDescription("روم البانل")
        .setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o =>
      o.setName("category").setDescription("كاتيجوري اللوبي")
        .setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [cmd.toJSON()] }
  );
}

function controlButtons(data) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("unlock").setLabel("Unlock").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("close").setLabel("Close").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("toggle_request")
      .setLabel(`Request: ${data.requestJoin ? "ON" : "OFF"}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("view_requests")
      .setLabel("Requests")
      .setStyle(ButtonStyle.Secondary)
  );
}

function setupLobby(client, store) {

client.on("interactionCreate", async (i) => {
try {

//////////////////////////////////////////
// SETUP
//////////////////////////////////////////

if (i.isChatInputCommand() && i.commandName === "setup") {
  await i.deferReply({ ephemeral: true });

  store.set(cfgKey("panel"), i.options.getChannel("panel").id);
  store.set(cfgKey("category"), i.options.getChannel("category").id);

  const embed = new EmbedBuilder()
    .setTitle("Rising Flames")
    .setDescription("اختر لعبتك")
    .setColor(0xff5500);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("game")
    .setPlaceholder("اختر لعبة")
    .addOptions(
      { label: "MOBILE LEGENDS", value: "ML" },
      { label: "CALL OF DUTY MOBILE", value: "CODM" }
    );

  await i.options.getChannel("panel").send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  });

  return i.editReply("تم الإعداد.");
}

//////////////////////////////////////////
// اختيار لعبة
//////////////////////////////////////////

if (i.isStringSelectMenu() && i.customId === "game") {
  await i.reply({
    ephemeral: true,
    embeds: [
      new EmbedBuilder()
        .setTitle(`Lobby • ${i.values[0]}`)
        .setColor(0xff5500)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`create:${i.values[0]}`).setLabel("Create Lobby").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`find:${i.values[0]}`).setLabel("Find Players").setStyle(ButtonStyle.Primary)
      )
    ]
  });
}

//////////////////////////////////////////
// CREATE
//////////////////////////////////////////

if (i.isButton() && i.customId.startsWith("create:")) {
  const game = i.customId.split(":")[1];

  const modal = new ModalBuilder()
    .setCustomId(`create_modal:${game}`)
    .setTitle("Create Lobby");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("player_id")
        .setLabel("اكتب ID مالك داخل اللعبة")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );

  return i.showModal(modal);
}

if (i.isModalSubmit() && i.customId.startsWith("create_modal:")) {
  await i.deferReply({ ephemeral: true });

  const category = store.get(cfgKey("category"));
  const game = i.customId.split(":")[1];
  const id = i.fields.getTextInputValue("player_id");

  const ch = await i.guild.channels.create({
    name: `${game}-${i.user.username}`.toLowerCase(),
    type: ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
    ]
  });

  const data = {
    game,
    owner: i.user.id,
    requestJoin: false,
    locked: false,
    members: [i.user.id],
    playerIds: { [i.user.id]: id }
  };

  store.set(lobbyKey(ch.id), data);
  store.set(pendingKey(ch.id), []);

  await ch.send({
    content: `Lobby Owner: <@${i.user.id}>`,
    components: [controlButtons(data)]
  });

  return i.editReply(`تم إنشاء ${ch}`);
}

//////////////////////////////////////////
// FIND
//////////////////////////////////////////

if (i.isButton() && i.customId.startsWith("find:")) {
  await i.deferReply({ ephemeral: true });
  const game = i.customId.split(":")[1];

  const lobbies = store.all().filter(x =>
    x.key.startsWith("lobby:") && x.value.game === game
  );

  if (!lobbies.length)
    return i.editReply("لا يوجد لوبيات.");

  const options = lobbies.map(l => ({
    label: l.key.split(":")[1],
    value: l.key,
    description: `${stateEmoji(l.value)} ${l.value.members.length}/5`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("join")
    .setPlaceholder("اختر لوبي")
    .addOptions(options);

  return i.editReply({
    components: [new ActionRowBuilder().addComponents(menu)]
  });
}

//////////////////////////////////////////
// REQUEST JOIN
//////////////////////////////////////////

if (i.isStringSelectMenu() && i.customId === "join") {

  const key = i.values[0];
  const data = store.get(key);
  const channelId = key.split(":")[1];
  const ch = await i.guild.channels.fetch(channelId);

  if (data.locked)
    return i.reply({ content: "🔴 اللوبي مقفل.", ephemeral: true });

  if (isFull(data))
    return i.reply({ content: "🔴 اللوبي ممتلئ.", ephemeral: true });

  if (data.requestJoin) {
    const modal = new ModalBuilder()
      .setCustomId(`request_modal:${channelId}`)
      .setTitle("Request Join");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("player_id")
          .setLabel("اكتب ID مالك داخل اللعبة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    return i.showModal(modal);
  }

  await ch.permissionOverwrites.edit(i.user.id, {
    ViewChannel: true,
    SendMessages: true
  });

  data.members.push(i.user.id);
  store.set(key, data);

  return i.reply({ content: `تم إدخالك ${ch}`, ephemeral: true });
}

//////////////////////////////////////////
// استقبال الطلب
//////////////////////////////////////////

if (i.isModalSubmit() && i.customId.startsWith("request_modal:")) {
  await i.deferReply({ ephemeral: true });

  const channelId = i.customId.split(":")[1];
  const id = i.fields.getTextInputValue("player_id");

  const pending = store.get(pendingKey(channelId)) || [];
  pending.push({ user: i.user.id, id });
  store.set(pendingKey(channelId), pending);

  return i.editReply("تم إرسال طلب الانضمام.");
}

//////////////////////////////////////////
// VIEW REQUESTS BUTTON
//////////////////////////////////////////

if (i.isButton() && i.customId === "view_requests") {
  const data = store.get(lobbyKey(i.channelId));
  if (!data || i.user.id !== data.owner)
    return i.reply({ content: "فقط صاحب اللوبي.", ephemeral: true });

  const pending = store.get(pendingKey(i.channelId)) || [];
  if (!pending.length)
    return i.reply({ content: "لا يوجد طلبات.", ephemeral: true });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_request")
    .setPlaceholder("اختر شخص")
    .addOptions(
      pending.map(p => ({
        label: p.user,
        value: `${p.user}|${p.id}`,
        description: `ID: ${p.id}`
      }))
    );

  return i.reply({
    ephemeral: true,
    components: [new ActionRowBuilder().addComponents(menu)]
  });
}

//////////////////////////////////////////
// اختيار طلب
//////////////////////////////////////////

if (i.isStringSelectMenu() && i.customId === "select_request") {

  const [userId, playerId] = i.values[0].split("|");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${userId}|${playerId}`).setLabel("قبول").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject:${userId}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
  );

  return i.reply({ ephemeral: true, components: [row] });
}

//////////////////////////////////////////
// approve / reject
//////////////////////////////////////////

if (i.isButton() && i.customId.startsWith("approve:")) {
  await i.deferReply({ ephemeral: true });

  const [userId, playerId] = i.customId.split(":")[1].split("|");
  const data = store.get(lobbyKey(i.channelId));
  const ch = await i.guild.channels.fetch(i.channelId);

  await ch.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: true
  });

  data.members.push(userId);
  data.playerIds[userId] = playerId;
  store.set(lobbyKey(i.channelId), data);

  return i.editReply("تمت الموافقة.");
}

if (i.isButton() && i.customId.startsWith("reject:")) {
  return i.reply({ content: "تم الرفض.", ephemeral: true });
}

} catch (e) {
  console.error(e);
}
});
}

module.exports = { registerCommands, setupLobby };
