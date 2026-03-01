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

function lobbyKey(id) {
  return `lobby:${id}`;
}

function isFull(l) {
  return (l.members?.length ?? 0) >= 5;
}

function findUserLobby(store, userId) {
  return store.all().find(l =>
    l.key.startsWith("lobby:") &&
    l.value.members?.some(m => m.id === userId)
  );
}

async function registerCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد روم اللوبي")
    .addChannelOption(o =>
      o.setName("panel").setDescription("روم اللوبي panel")
        .setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o =>
      o.setName("category").setDescription("كاتيجوري الرومات")
        .setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [cmd.toJSON()] }
  );
}

function buildLobbyEmbed(data) {
  return new EmbedBuilder()
    .setTitle(`Lobby • ${data.game}`)
    .setDescription(
      `الحالة: ${data.locked ? "🔴 مغلق" : "🟢 مفتوح"}\n` +
      `الأعضاء: ${data.members.length}/5`
    )
    .setImage("https://i.imgur.com/your-image.png"); // ضع رابط صورتك
}

function buildControls(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lock:${channelId}`)
      .setLabel("Lock")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`unlock:${channelId}`)
      .setLabel("Unlock")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`close:${channelId}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`leave:${channelId}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Primary)
  );
}

function setupLobby(client, store) {

  client.on("interactionCreate", async (i) => {
    try {

      // SETUP
      if (i.isChatInputCommand() && i.commandName === "setup") {
        await i.deferReply({ ephemeral: true });

        store.set("panelChannel", i.options.getChannel("panel").id);
        store.set("categoryId", i.options.getChannel("category").id);

        const embed = new EmbedBuilder()
          .setTitle("Rising Flames")
          .setDescription("اختر لعبتك")
          .setImage("https://i.imgur.com/your-image.png");

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

      // GAME SELECT
      if (i.isStringSelectMenu() && i.customId === "game") {
        await i.deferReply({ ephemeral: true });

        const game = i.values[0];

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`create:${game}`)
            .setLabel("Create Lobby").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`find:${game}`)
            .setLabel("Find Players").setStyle(ButtonStyle.Primary)
        );

        return i.editReply({ content: `Lobby • ${game}`, components: [row] });
      }

      // CREATE BUTTON
      if (i.isButton() && i.customId.startsWith("create:")) {
        const existing = findUserLobby(store, i.user.id);
        if (existing)
          return i.reply({ content: "أنت داخل لوبي بالفعل.", ephemeral: true });

        const game = i.customId.split(":")[1];

        const modal = new ModalBuilder()
          .setCustomId(`modal:${game}`)
          .setTitle("Create Lobby");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("id")
              .setLabel("UID داخل اللعبة")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }

      // CREATE MODAL SUBMIT
      if (i.isModalSubmit() && i.customId.startsWith("modal:")) {
        await i.deferReply({ ephemeral: true });

        const category = store.get("categoryId");
        const game = i.customId.split(":")[1];
        const uid = i.fields.getTextInputValue("id");

        const ch = await i.guild.channels.create({
          name: `${game}-${i.user.username}`.toLowerCase(),
          type: ChannelType.GuildText,
          parent: category,
          permissionOverwrites: [
            { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        const data = {
          game,
          owner: i.user.id,
          uid,
          members: [{ id: i.user.id, uid }],
          locked: false
        };

        store.set(lobbyKey(ch.id), data);

        await ch.send({
          embeds: [buildLobbyEmbed(data)],
          components: [buildControls(ch.id)]
        });

        await ch.send(`UID صاحب اللوبي: **${uid}**`);

        return i.editReply(`تم إنشاء اللوبي ${ch}`);
      }

      // FIND
      if (i.isButton() && i.customId.startsWith("find:")) {
        await i.deferReply({ ephemeral: true });

        const game = i.customId.split(":")[1];

        const lobbies = store.all()
          .filter(x => x.key.startsWith("lobby:") && x.value.game === game);

        if (!lobbies.length)
          return i.editReply("لا يوجد لوبيات.");

        const options = lobbies.map(l => ({
          label: l.value.uid,
          value: l.key,
          description: `${l.value.locked ? "🔴" : "🟢"} ${l.value.members.length}/5`,
        }));

        const menu = new StringSelectMenuBuilder()
          .setCustomId("join")
          .setPlaceholder("اختر لوبي")
          .addOptions(options);

        return i.editReply({
          components: [new ActionRowBuilder().addComponents(menu)]
        });
      }

      // JOIN SELECT
      if (i.isStringSelectMenu() && i.customId === "join") {

        const key = i.values[0];
        const data = store.get(key);
        if (!data)
          return i.reply({ content: "اللوبي غير موجود.", ephemeral: true });

        if (data.members.some(m => m.id === i.user.id))
          return i.reply({ content: "أنت داخل هذا اللوبي بالفعل.", ephemeral: true });

        if (data.locked)
          return i.reply({ content: "اللوبي مقفل.", ephemeral: true });

        if (isFull(data))
          return i.reply({ content: "اللوبي ممتلئ.", ephemeral: true });

        const existing = findUserLobby(store, i.user.id);
        if (existing)
          return i.reply({ content: "أنت داخل لوبي آخر بالفعل.", ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`joinmodal:${key}`)
          .setTitle("أدخل UID");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("uid")
              .setLabel("UID داخل اللعبة")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }

      // JOIN MODAL SUBMIT
      if (i.isModalSubmit() && i.customId.startsWith("joinmodal:")) {
        await i.deferReply({ ephemeral: true });

        const key = i.customId.split(":")[1];
        const data = store.get(key);
        if (!data) return i.editReply("اللوبي غير موجود.");

        const uid = i.fields.getTextInputValue("uid");
        const channelId = key.split(":")[1];
        const ch = await i.guild.channels.fetch(channelId);

        await ch.permissionOverwrites.edit(i.user.id, {
          ViewChannel: true,
          SendMessages: true,
        });

        data.members.push({ id: i.user.id, uid });
        store.set(key, data);

        await ch.send(`UID اللاعب <@${i.user.id}>: **${uid}**`);

        return i.editReply(`تم إدخالك ${ch}`);
      }

    } catch (e) {
      console.error(e);
    }
  });
}

module.exports = { registerCommands, setupLobby };
