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

async function getDisplayName(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached?.user) return cached.user.globalName || cached.user.username;

  const fetched = await guild.members.fetch(userId).catch(() => null);
  if (fetched?.user) return fetched.user.globalName || fetched.user.username;

  return userId; // fallback
}

async function registerCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد روم اللوبي")
    .addChannelOption(o =>
      o.setName("panel")
        .setDescription("روم اللوبي panel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o =>
      o.setName("category")
        .setDescription("كاتيجوري الرومات")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory))
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
      `الأعضاء: ${data.members.length}/5\n` +
      `المالك: <@${data.owner}>`
    )
    .setImage("https://i.imgur.com/JkWND0m.png");
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
      .setCustomId(`transfer:${channelId}`)
      .setLabel("نقل 👑")
      .setStyle(ButtonStyle.Secondary),

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
        const game = i.values[0];

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`create:${game}`)
            .setLabel("Create Lobby")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`find:${game}`)
            .setLabel("Find Players")
            .setStyle(ButtonStyle.Primary)
        );

        return i.reply({
          content: `Lobby • ${game}`,
          components: [row],
          ephemeral: true
        });
      }

      // CREATE BUTTON
      if (i.isButton() && i.customId.startsWith("create:")) {

        if (findUserLobby(store, i.user.id))
          return i.reply({ content: "أنت داخل لوبي بالفعل.", ephemeral: true });

        const game = i.customId.split(":")[1];

        const modal = new ModalBuilder()
          .setCustomId(`modal:${game}`)
          .setTitle("Create Lobby")
          .addComponents(
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

      // CREATE MODAL
      if (i.isModalSubmit() && i.customId.startsWith("modal:")) {

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

        const msg = await ch.send({
          embeds: [buildLobbyEmbed(data)],
          components: [buildControls(ch.id)]
        });

        data.messageId = msg.id;
        store.set(lobbyKey(ch.id), data);

        await ch.send(`UID صاحب اللوبي: **${uid}**`);

        return i.reply({ content: `تم إنشاء اللوبي ${ch}`, ephemeral: true });
      }

      // FIND
      if (i.isButton() && i.customId.startsWith("find:")) {

        const game = i.customId.split(":")[1];

        const lobbies = store.all()
          .filter(x => x.key.startsWith("lobby:") && x.value.game === game);

        if (!lobbies.length)
          return i.reply({ content: "لا يوجد لوبيات.", ephemeral: true });

        // ✅ label = يوزر المالك فقط
        const options = await Promise.all(
          lobbies.map(async (l) => {
            const ownerName = await getDisplayName(i.guild, l.value.owner);
            return {
              label: ownerName.slice(0, 100),
              value: l.key,
              description: `${l.value.locked ? "🔴" : "🟢"} ${l.value.members.length}/5`,
            };
          })
        );

        const menu = new StringSelectMenuBuilder()
          .setCustomId("join")
          .setPlaceholder("اختر لوبي")
          .addOptions(options);

        return i.reply({
          components: [new ActionRowBuilder().addComponents(menu)],
          ephemeral: true
        });
      }

      // JOIN SELECT
      if (i.isStringSelectMenu() && i.customId === "join") {

        const key = i.values[0];
        const data = store.get(key);
        if (!data) return i.reply({ content: "اللوبي غير موجود.", ephemeral: true });

        if (data.locked)
          return i.reply({ content: "اللوبي مقفل.", ephemeral: true });

        if (isFull(data))
          return i.reply({ content: "اللوبي ممتلئ.", ephemeral: true });

        if (findUserLobby(store, i.user.id))
          return i.reply({ content: "أنت داخل لوبي آخر.", ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`joinmodal:${key}`)
          .setTitle("أدخل UID")
          .addComponents(
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

      // JOIN MODAL
      if (i.isModalSubmit() && i.customId.startsWith("joinmodal:")) {

        const key = i.customId.replace("joinmodal:", "");
        const data = store.get(key);
        if (!data) return i.reply({ content: "اللوبي غير موجود.", ephemeral: true });

        const uid = i.fields.getTextInputValue("uid");
        const channelId = key.replace("lobby:", "");
        const ch = await i.guild.channels.fetch(channelId);

        await ch.permissionOverwrites.edit(i.user.id, {
          ViewChannel: true,
          SendMessages: true,
        });

        data.members.push({ id: i.user.id, uid });
        store.set(key, data);

        try {
          const msg = await ch.messages.fetch(data.messageId);
          await msg.edit({
            embeds: [buildLobbyEmbed(data)],
            components: [buildControls(channelId)]
          });
        } catch {}

        await ch.send(`UID اللاعب <@${i.user.id}>: **${uid}**`);

        return i.reply({ content: `تم إدخالك ${ch}`, ephemeral: true });
      }

      // TRANSFER SELECT
      if (i.isStringSelectMenu() && i.customId.startsWith("transferselect:")) {

        const channelId = i.customId.split(":")[1];
        const key = lobbyKey(channelId);
        const data = store.get(key);
        if (!data) return i.reply({ content: "اللوبي غير موجود.", ephemeral: true });

        const newOwnerId = i.values[0];
        data.owner = newOwnerId;
        store.set(key, data);

        const ch = await i.guild.channels.fetch(channelId);

        try {
          const msg = await ch.messages.fetch(data.messageId);
          await msg.edit({
            embeds: [buildLobbyEmbed(data)],
            components: [buildControls(channelId)]
          });
        } catch {}

        await ch.send(`تم نقل ملكية اللوبي إلى <@${newOwnerId}>`);

        return i.reply({ content: "تم نقل الملكية.", ephemeral: true });
      }

      // CONTROLS
      if (i.isButton()) {

        const [action, channelId] = i.customId.split(":");
        const key = lobbyKey(channelId);
        const data = store.get(key);
        if (!data) return;

        const ch = await i.guild.channels.fetch(channelId);

        if (action === "lock") {
          if (i.user.id !== data.owner)
            return i.reply({ content: "فقط المالك يستطيع القفل.", ephemeral: true });

          data.locked = true;
          store.set(key, data);
        }

        if (action === "unlock") {
          if (i.user.id !== data.owner)
            return i.reply({ content: "فقط المالك يستطيع الفتح.", ephemeral: true });

          data.locked = false;
          store.set(key, data);
        }

        if (action === "transfer") {

          if (i.user.id !== data.owner)
            return i.reply({ content: "فقط المالك يستطيع نقل الملكية.", ephemeral: true });

          // ✅ الخيارات تظهر يوزرات الأعضاء بدل ID
          const options = await Promise.all(
            data.members
              .filter(m => m.id !== data.owner)
              .map(async (m) => {
                const name = await getDisplayName(i.guild, m.id);
                return {
                  label: name.slice(0, 100),
                  value: m.id
                };
              })
          );

          if (!options.length)
            return i.reply({ content: "لا يوجد أعضاء.", ephemeral: true });

          const menu = new StringSelectMenuBuilder()
            .setCustomId(`transferselect:${channelId}`)
            .setPlaceholder("اختر العضو")
            .addOptions(options);

          return i.reply({
            components: [new ActionRowBuilder().addComponents(menu)],
            ephemeral: true
          });
        }

        if (action === "leave") {

          const leavingOwner = i.user.id === data.owner;

          data.members = data.members.filter(m => m.id !== i.user.id);
          await ch.permissionOverwrites.delete(i.user.id).catch(() => {});

          if (!data.members.length) {
            await ch.delete();
            store.del(key);
            return i.reply({ content: "تم حذف اللوبي.", ephemeral: true });
          }

          if (leavingOwner) {
            data.owner = data.members[0].id;
            await ch.send(`تم نقل الملكية تلقائياً إلى <@${data.owner}>`);
          }

          store.set(key, data);
        }

        if (action === "close") {
          if (i.user.id !== data.owner)
            return i.reply({ content: "فقط المالك يستطيع الإغلاق.", ephemeral: true });

          await ch.delete();
          store.del(key);
          return i.reply({ content: "تم إغلاق اللوبي.", ephemeral: true });
        }

        try {
          const msg = await ch.messages.fetch(data.messageId);
          await msg.edit({
            embeds: [buildLobbyEmbed(data)],
            components: [buildControls(channelId)]
          });
        } catch {}

        return i.reply({ content: "تم التحديث.", ephemeral: true });
      }

    } catch (e) {
      console.error(e);
    }
  });
}

module.exports = { registerCommands, setupLobby };
