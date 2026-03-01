require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { createStore } = require("./src/store");
const { registerCommands, setupLobby } = require("./src/lobby");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const store = createStore("data.json");

client.once("ready", async () => {
  console.log("Lobby Bot Ready");
  await registerCommands();
});

setupLobby(client, store);

client.login(process.env.BOT_TOKEN);
