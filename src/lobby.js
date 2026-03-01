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
          .setDescription("اختر لعبتك");

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

      // CREATE
      if (i.isButton() && i.customId.startsWith("create:")) {
        const game = i.customId.split(":")[1];

        const modal = new ModalBuilder()
          .setCustomId(`modal:${game}`)
          .setTitle("Create Lobby");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("id")
              .setLabel("ID داخل اللعبة")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }

      if (i.isModalSubmit() && i.customId.startsWith("modal:")) {
        await i.deferReply({ ephemeral: true });

        const category = store.get("categoryId");
        const game = i.customId.split(":")[1];

        const ch = await i.guild.channels.create({
          name: `${game}-${i.user.username}`.toLowerCase(),
          type: ChannelType.GuildText,
          parent: category,
          permissionOverwrites: [
            { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });

        store.set(lobbyKey(ch.id), {
          game,
          owner: i.user.id,
          members: [i.user.id],
          locked: false
        });

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
          label: l.key.split(":")[1],
          value: l.key,
          description: `${l.value.members.length}/5`,
        }));

        const menu = new StringSelectMenuBuilder()
          .setCustomId("join")
          .setPlaceholder("اختر لوبي")
          .addOptions(options);

        return i.editReply({
          components: [new ActionRowBuilder().addComponents(menu)]
        });
      }

      // JOIN
      if (i.isStringSelectMenu() && i.customId === "join") {
        await i.deferReply({ ephemeral: true });

        const key = i.values[0];
        const data = store.get(key);
        if (!data) return i.editReply("اللوبي غير موجود.");

        if (data.locked) return i.editReply("اللوبي مقفل.");
        if (isFull(data)) return i.editReply("اللوبي ممتلئ.");

        const channelId = key.split(":")[1];
        const ch = await i.guild.channels.fetch(channelId);

        await ch.permissionOverwrites.edit(i.user.id, {
          ViewChannel: true,
          SendMessages: true,
        });

        data.members.push(i.user.id);
        store.set(key, data);

        return i.editReply(`تم إدخالك ${ch}`);
      }

    } catch (e) {
      console.error(e);
    }
  });
}

module.exports = { registerCommands, setupLobby };
