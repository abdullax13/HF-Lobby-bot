// index.js
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { createStore } = require("./src/store");
const { registerCommands, setupLobby } = require("./src/lobby");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const store = createStore("data.json");

client.once("ready", async () => {
  console.log(`Lobby Bot Ready: ${client.user.tag}`);
  await registerCommands();
});

setupLobby(client, store);

client.login(process.env.BOT_TOKEN);
