require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const startHandler = require('./handlers/start');
const sellFlow = require('./handlers/sellFlow');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => startHandler(bot, msg));
bot.on('callback_query', (query) => sellFlow(bot, query));
bot.on('message', (msg) => sellFlow.handleMessage(bot, msg));
