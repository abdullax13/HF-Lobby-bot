// src/lobby.js
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

const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 5);

function lobbyKey(id) { return `lobby:${id}`; }
function pendingKey(chId) { return `pending:${chId}`; } // array of {userId, playerId}
function cfgKey(k) { return `cfg:${k}`; }

function isFull(l) { return (l.members?.length ?? 0) >= MAX_PLAYERS; }
function stateEmoji(l) { return (l.locked || isFull(l)) ? "🔴" : "🟢"; }
function stateText(l) { return isFull(l) ? "ممتلئ" : (l.locked ? "مقفل" : "مفتوح"); }

async function registerCommands() {
  const cmd = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد روم اللوبي + كاتيجوري")
    .addChannelOption(o =>
      o.setName("panel").setDescription("الروم اللي ينرسل فيه Panel")
        .setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o =>
      o.setName("category").setDescription("كاتيجوري رومات اللوبي")
        .setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [cmd.toJSON()] }
  );
}

async function sendOrUpdatePanel(channel, store) {
  const embed = new EmbedBuilder()
    .setTitle("Rising Flames")
    .setDescription("اختر لعبتك عشان تسوي Lobby أو تلقى لاعبين.")
    .setColor(0xff5500);

  if (process.env.LOBBY_BANNER_URL) embed.setImage(process.env.LOBBY_BANNER_URL);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("game_select")
    .setPlaceholder("اختر لعبة")
    .addOptions(
      { label: "MOBILE LEGENDS", value: "ML" },
      { label: "CALL OF DUTY MOBILE", value: "CODM" }
    );

  const row = new ActionRowBuilder().addComponents(menu);

  const msgId = store.get(cfgKey("panelMsgId"));
  if (msgId) {
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components: [row] });
      return;
    }
  }

  const msg = await channel.send({ embeds: [embed], components: [row] });
  store.set(cfgKey("panelMsgId"), msg.id);
}

async function getValidLobbies(guild, store, game) {
  const all = store.all()
    .filter(x => x.key.startsWith("lobby:") && x.value?.game === game)
    .map(x => ({ channelId: x.key.split(":")[1], data: x.value }));

  const valid = [];
  for (const it of all) {
    const ch = await guild.channels.fetch(it.channelId).catch(() => null);
    if (!ch) {
      store.del(lobbyKey(it.channelId));
      store.del(pendingKey(it.channelId));
      continue;
    }
    valid.push({ channel: ch, data: it.data });
  }
  return valid;
}

function lobbyControlsRow(lobbyData) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lobby_lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lobby_unlock").setLabel("Unlock").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("lobby_close").setLabel("Close").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("lobby_toggle_request")
      .setLabel(lobbyData.requestJoin ? "Request: ON" : "Request: OFF")
      .setStyle(ButtonStyle.Primary)
  );
}

function setupLobby(client, store) {
  client.on("interactionCreate", async (i) => {
    try {

      // /setup
      if (i.isChatInputCommand() && i.commandName === "setup") {
        await i.deferReply({ ephemeral: true });

        const panel = i.options.getChannel("panel", true);
        const category = i.options.getChannel("category", true);

        store.set(cfgKey("panelChannelId"), panel.id);
        store.set(cfgKey("categoryId"), category.id);

        await sendOrUpdatePanel(panel, store);

        return i.editReply("تم الإعداد + إرسال Panel.");
      }

      // اختيار لعبة
      if (i.isStringSelectMenu() && i.customId === "game_select") {
        await i.deferReply({ ephemeral: true });

        const game = i.values[0];

        const embed = new EmbedBuilder()
          .setTitle(`Lobby • ${game}`)
          .setDescription("اختر:")
          .setColor(0xff5500);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`create:${game}`).setLabel("Create Lobby").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`find:${game}`).setLabel("Find Players").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`refresh:${game}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
        );

        return i.editReply({ embeds: [embed], components: [row] });
      }

      // Refresh (يحل مشكلة لازم تغيّر لعبة)
      if (i.isButton() && i.customId.startsWith("refresh:")) {
        await i.deferReply({ ephemeral: true });
        const game = i.customId.split(":")[1];
        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`Lobby • ${game}`)
              .setDescription("اختر:")
              .setColor(0xff5500)
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`create:${game}`).setLabel("Create Lobby").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`find:${game}`).setLabel("Find Players").setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`refresh:${game}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
            )
          ]
        });
      }

      // Create Lobby -> modal
      if (i.isButton() && i.customId.startsWith("create:")) {
        const game = i.customId.split(":")[1];

        const modal = new ModalBuilder()
          .setCustomId(`modal_create:${game}`)
          .setTitle(`Create Lobby • ${game}`);

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

      // submit create
      if (i.isModalSubmit() && i.customId.startsWith("modal_create:")) {
        await i.deferReply({ ephemeral: true });

        const categoryId = store.get(cfgKey("categoryId"));
        if (!categoryId) return i.editReply("لازم /setup أولاً.");

        const game = i.customId.split(":")[1];
        const playerId = i.fields.getTextInputValue("player_id");

        const ch = await i.guild.channels.create({
          name: `${game.toLowerCase()}-${i.user.username}`.replace(/\s+/g, "-").slice(0, 90),
          type: ChannelType.GuildText,
          parent: categoryId,
          permissionOverwrites: [
            { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
              id: i.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
              ],
            },
          ],
        });

        const lobbyData = {
          game,
          ownerId: i.user.id,
          requestJoin: false,
          locked: false,
          members: [i.user.id],
          playerIds: { [i.user.id]: playerId },
          createdAt: Date.now(),
        };

        store.set(lobbyKey(ch.id), lobbyData);
        store.set(pendingKey(ch.id), []);

        await ch.send({
          content: `Lobby created by <@${i.user.id}>\nGame ID: **${playerId}**\n(Max ${MAX_PLAYERS} players)`,
          components: [lobbyControlsRow(lobbyData)],
        });

        return i.editReply(`تم إنشاء اللوبي: ${ch}`);
      }

      // Find Players (يجيب أحدث وضع دائماً + 🟢🔴)
      if (i.isButton() && i.customId.startsWith("find:")) {
        await i.deferReply({ ephemeral: true });

        const game = i.customId.split(":")[1];

        const lobbies = await getValidLobbies(i.guild, store, game);
        if (!lobbies.length) return i.editReply("لا يوجد لوبيات حالياً.");

        const options = lobbies.slice(0, 25).map(({ channel, data }) => {
          const count = `${(data.members?.length ?? 0)}/${MAX_PLAYERS}`;
          const emoji = stateEmoji(data);
          return {
            label: `#${channel.name}`,
            value: `pick:${channel.id}`,
            description: `${stateText(data)} • ${count}`,
            emoji: { name: emoji },
          };
        });

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`lobby_pick:${game}`) // مهم: game داخل customId عشان ما يصير caching
          .setPlaceholder("اختر لوبي")
          .addOptions(options);

        return i.editReply({
          content: `لوبيات ${game}:`,
          components: [new ActionRowBuilder().addComponents(menu)],
        });
      }

      // اختيار لوبي -> إذا RequestJoin يفتح modal طلب / إذا مفتوح يدخل مباشرة
      if (i.isStringSelectMenu() && i.customId.startsWith("lobby_pick:")) {
        await i.deferReply({ ephemeral: true });

        const channelId = i.values[0].split(":")[1];
        const data = store.get(lobbyKey(channelId));
        if (!data) return i.editReply("اللوبي غير موجود.");

        const ch = await i.guild.channels.fetch(channelId).catch(() => null);
        if (!ch) {
          store.del(lobbyKey(channelId));
          store.del(pendingKey(channelId));
          return i.editReply("اللوبي غير موجود.");
        }

        if (data.locked) return i.editReply("🔴 اللوبي مقفل.");
        if (isFull(data)) return i.editReply("🔴 اللوبي ممتلئ.");

        // إذا requestJoin -> لازم يرسل طلب + يكتب ID
        if (data.requestJoin) {
          const modal = new ModalBuilder()
            .setCustomId(`modal_join:${channelId}`)
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

        // دخول مباشر
        if (data.members?.includes(i.user.id)) return i.editReply(`أنت داخل بالفعل: ${ch}`);

        await ch.permissionOverwrites.edit(i.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => null);

        data.members = Array.from(new Set([...(data.members || []), i.user.id]));
        store.set(lobbyKey(channelId), data);

        await ch.send(`🟢 <@${i.user.id}> دخل اللوبي. (${data.members.length}/${MAX_PLAYERS})`).catch(() => {});
        return i.editReply(`🟢 تم إدخالك: ${ch}`);
      }

      // submit request join
      if (i.isModalSubmit() && i.customId.startsWith("modal_join:")) {
        await i.deferReply({ ephemeral: true });

        const channelId = i.customId.split(":")[1];
        const data = store.get(lobbyKey(channelId));
        if (!data) return i.editReply("اللوبي غير موجود.");

        if (data.locked) return i.editReply("🔴 اللوبي مقفل.");
        if (isFull(data)) return i.editReply("🔴 اللوبي ممتلئ.");

        const playerId = i.fields.getTextInputValue("player_id");

        const pending = store.get(pendingKey(channelId)) || [];
        if (pending.find(p => p.userId === i.user.id)) {
          return i.editReply("طلبك موجود مسبقاً.");
        }

        pending.push({ userId: i.user.id, playerId });
        store.set(pendingKey(channelId), pending);

        const owner = await i.guild.members.fetch(data.ownerId).catch(() => null);
        const ch = await i.guild.channels.fetch(channelId).catch(() => null);

        // نرسل لصاحب اللوبي داخل روم اللوبي (أفضل من DM عشان ما ينقفل)
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("Request Join")
            .setDescription(`المتقدم: <@${i.user.id}>\nID: **${playerId}**`)
            .setColor(0xff5500);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`req_accept:${channelId}:${i.user.id}`).setLabel("قبول").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`req_reject:${channelId}:${i.user.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
          );

          await ch.send({ embeds: [embed], components: [row] }).catch(() => {});
        }

        return i.editReply("تم إرسال طلب الانضمام لصاحب اللوبي.");
      }

      // approve / reject
      if (i.isButton() && (i.customId.startsWith("req_accept:") || i.customId.startsWith("req_reject:"))) {
        await i.deferReply({ ephemeral: true });

        const [action, channelId, userId] = i.customId.split(":");
        const data = store.get(lobbyKey(channelId));
        if (!data) return i.editReply("اللوبي غير موجود.");

        if (i.user.id !== data.ownerId) return i.editReply("بس صاحب اللوبي يقدر يوافق/يرفض.");

        const pending = store.get(pendingKey(channelId)) || [];
        const req = pending.find(p => p.userId === userId);
        if (!req) return i.editReply("الطلب غير موجود.");

        const ch = await i.guild.channels.fetch(channelId).catch(() => null);
        if (!ch) return i.editReply("الروم غير موجود.");

        if (action === "req_reject") {
          store.set(pendingKey(channelId), pending.filter(p => p.userId !== userId));
          return i.editReply("تم رفض الطلب.");
        }

        // accept
        if (data.locked) return i.editReply("اللوبي مقفل.");
        if (isFull(data)) return i.editReply("اللوبي ممتلئ.");

        await ch.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => null);

        data.members = Array.from(new Set([...(data.members || []), userId]));
        data.playerIds = data.playerIds || {};
        data.playerIds[userId] = req.playerId;

        store.set(lobbyKey(channelId), data);
        store.set(pendingKey(channelId), pending.filter(p => p.userId !== userId));

        await ch.send(`🟢 تم قبول <@${userId}>. (${data.members.length}/${MAX_PLAYERS})`).catch(() => {});
        return i.editReply("تم قبول الطلب وإدخاله اللوبي.");
      }

      // أزرار التحكم داخل اللوبي (Lock/Unlock/Close/Toggle Request)
      if (i.isButton() && ["lobby_lock", "lobby_unlock", "lobby_close", "lobby_toggle_request"].includes(i.customId)) {
        const data = store.get(lobbyKey(i.channelId));
        if (!data) return i.reply({ content: "هذا مو روم لوبي.", ephemeral: true });

        if (i.user.id !== data.ownerId) {
          return i.reply({ content: "بس صاحب اللوبي يقدر يتحكم.", ephemeral: true });
        }

        if (i.customId === "lobby_lock") {
          data.locked = true;
          store.set(lobbyKey(i.channelId), data);
          await i.reply({ content: "🔴 تم قفل اللوبي.", ephemeral: true });
          return i.message.edit({ components: [lobbyControlsRow(data)] }).catch(() => {});
        }

        if (i.customId === "lobby_unlock") {
          data.locked = false;
          store.set(lobbyKey(i.channelId), data);
          await i.reply({ content: "🟢 تم فتح اللوبي.", ephemeral: true });
          return i.message.edit({ components: [lobbyControlsRow(data)] }).catch(() => {});
        }

        if (i.customId === "lobby_toggle_request") {
          data.requestJoin = !data.requestJoin;
          store.set(lobbyKey(i.channelId), data);
          await i.reply({ content: `Request Join: ${data.requestJoin ? "ON" : "OFF"}`, ephemeral: true });
          return i.message.edit({ components: [lobbyControlsRow(data)] }).catch(() => {});
        }

        if (i.customId === "lobby_close") {
          store.del(lobbyKey(i.channelId));
          store.del(pendingKey(i.channelId));
          await i.reply({ content: "تم إغلاق اللوبي.", ephemeral: true }).catch(() => {});
          return i.channel.delete().catch(() => {});
        }
      }

    } catch (e) {
      console.error("Lobby error:", e);
      if (i.isRepliable()) {
        if (i.deferred) return i.editReply("صار خطأ.").catch(() => {});
        return i.reply({ content: "صار خطأ.", ephemeral: true }).catch(() => {});
      }
    }
  });
}

module.exports = { registerCommands, setupLobby };
