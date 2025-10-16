// Load environment variables from the .env file
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const CoinPayments = require('coinpayments');

// --- BOT AND API INITIALIZATION ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN is not defined in your .env file.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const coinpaymentsClient = new CoinPayments({
    key: process.env.COINPAYMENTS_PUBLIC_KEY,
    secret: process.env.COINPAYMENTS_PRIVATE_KEY,
});

// --- CONSTANTS AND CONFIGURATION ---
const MIN_USDT = 25;
const MAX_USDT = 50000;

// Conversion Rates
const RATES = {
    USD_TO_USDT: 1.08, // 1 USD = 1.08 USDT
    USD_TO_EUR: 0.89,  // 1 USD = 0.89 EUR
    USDT_TO_GBP: 0.77  // 1 USDT = 0.77 GBP
};

// Calculate derived rates
const USDT_TO_USD_RATE = 1 / RATES.USD_TO_USDT;
const USDT_TO_EUR_RATE = USDT_TO_USD_RATE * RATES.USD_TO_EUR;

const userSessions = {}; // In-memory storage for user conversation state

console.log("🚀 USDT Seller Bot is running...");

// --- /start COMMAND HANDLER ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';

    // Reset any existing session
    delete userSessions[chatId];

    const welcomeText = `Hello **${firstName} ${lastName}**!\n\nWelcome to the USDT Seller Bot. I can help you sell your USDT for fiat currencies like USD, EUR, or GBP. Your funds will be sent directly to your preferred payment method.`;
    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ YES, Sell USDT', callback_data: 'start_sale' }],
                [{ text: '❌ NO', callback_data: 'cancel_sale' }]
            ]
        }
    };
    bot.sendMessage(chatId, welcomeText, options);
    bot.sendMessage(chatId, "Do you want to start the selling process?");
});

// --- CALLBACK QUERY HANDLER (for button clicks) ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Acknowledge the button press
    bot.answerCallbackQuery(query.id);

    if (data === 'start_sale') {
        startSaleProcess(chatId);
    } else if (data === 'cancel_sale') {
        bot.sendMessage(chatId, "No problem. Feel free to start again whenever you're ready. Just type /start.");
        delete userSessions[chatId];
    } else if (userSessions[chatId]) {
        const stage = userSessions[chatId].stage;
        if (stage === 'awaiting_fiat' && ['USD', 'EUR', 'GBP'].includes(data)) {
            handleFiatSelection(chatId, data);
        } else if (stage === 'awaiting_network' && ['USDT.BEP20', 'USDT.TRC20', 'USDT.ERC20'].includes(data)) {
            handleNetworkSelection(chatId, data);
        } else if (stage === 'awaiting_payment_method') {
            handlePaymentMethodSelection(chatId, data);
        }
    }
});


// --- TEXT MESSAGE HANDLER (for amount and payment details) ---
bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // Ignore commands and non-session messages
    if (msg.text.startsWith('/') || !userSessions[chatId]) {
        return;
    }

    const stage = userSessions[chatId].stage;

    if (stage === 'awaiting_amount') {
        handleAmountInput(chatId, msg.text);
    } else if (stage === 'awaiting_payment_details') {
        handlePaymentDetailsInput(chatId, msg.text);
    }
});

// --- PROCESS FUNCTIONS ---

function startSaleProcess(chatId) {
    userSessions[chatId] = { stage: 'awaiting_fiat' };

    const ratesText = `Here are the current rates:\n\n*USD to EUR:* \`${RATES.USD_TO_EUR}\`\n*USDT to GBP:* \`${RATES.USDT_TO_GBP}\`\n*USD to USDT:* \`${RATES.USD_TO_USDT}\``;
    bot.sendMessage(chatId, ratesText, { parse_mode: 'Markdown' });

    const fiatOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🇺🇸 USD', callback_data: 'USD' }, { text: '🇪🇺 EUR', callback_data: 'EUR' }, { text: '🇬🇧 GBP', callback_data: 'GBP' }]
            ]
        }
    };
    bot.sendMessage(chatId, "Which currency would you like to receive?", fiatOptions);
}

function handleFiatSelection(chatId, fiat) {
    userSessions[chatId].fiat = fiat;
    userSessions[chatId].stage = 'awaiting_network';

    const networkOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'USDT BEP20 (BSC)', callback_data: 'USDT.BEP20' }],
                [{ text: 'USDT TRC20 (TRON)', callback_data: 'USDT.TRC20' }],
                [{ text: 'USDT ERC20 (ETH)', callback_data: 'USDT.ERC20' }]
            ]
        }
    };
    bot.sendMessage(chatId, "Please choose the network for your USDT deposit:", networkOptions);
}

function handleNetworkSelection(chatId, network) {
    userSessions[chatId].network = network;
    userSessions[chatId].stage = 'awaiting_amount';
    bot.sendMessage(chatId, `Please enter the amount of USDT you want to sell.\n\nMinimum: **${MIN_USDT} USDT**\nMaximum: **${MAX_USDT} USDT**`, { parse_mode: 'Markdown' });
}

function handleAmountInput(chatId, text) {
    const amount = parseFloat(text);

    if (isNaN(amount) || amount < MIN_USDT || amount > MAX_USDT) {
        bot.sendMessage(chatId, `❌ Invalid amount. Please enter a number between ${MIN_USDT} and ${MAX_USDT}.`);
        return;
    }
    
    userSessions[chatId].amount = amount;

    // Calculate received amount
    const { fiat } = userSessions[chatId];
    let receivedAmount = 0;
    if (fiat === 'USD') receivedAmount = amount * USDT_TO_USD_RATE;
    if (fiat === 'EUR') receivedAmount = amount * USDT_TO_EUR_RATE;
    if (fiat === 'GBP') receivedAmount = amount * RATES.USDT_TO_GBP;

    bot.sendMessage(chatId, `You will receive approximately **${receivedAmount.toFixed(2)} ${fiat}**.`, { parse_mode: 'Markdown'});

    userSessions[chatId].stage = 'awaiting_payment_method';
    const paymentOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Wise', callback_data: 'wise' }, { text: 'Revolut', callback_data: 'revolut' }],
                [{ text: 'PayPal', callback_data: 'paypal' }, { text: 'Bank Transfer', callback_data: 'bank' }],
                [{ text: 'Skrill/Neteller', callback_data: 'skrill' }, { text: 'Visa/Mastercard', callback_data: 'card' }],
                [{ text: 'Payeer', callback_data: 'payeer' }, { text: 'Alipay', callback_data: 'alipay' }]
            ]
        }
    };
    bot.sendMessage(chatId, "How would you like to receive your payment?", paymentOptions);
}

function handlePaymentMethodSelection(chatId, method) {
    userSessions[chatId].paymentMethod = method;
    userSessions[chatId].stage = 'awaiting_payment_details';

    let prompt = '';
    switch (method) {
        case 'wise': prompt = 'Please provide your Wise email or WiseTag (e.g., @username).'; break;
        case 'revolut': prompt = 'Please provide your Revolut tag (Revtag).'; break;
        case 'paypal': prompt = 'Please provide your PayPal email.'; break;
        case 'bank': prompt = 'Please provide your bank details in this format:\n\nFirst and Last Name\nIBAN\nSWIFT Code'; break;
        case 'skrill': prompt = 'Please provide your Skrill/Neteller email.'; break;
        case 'card': prompt = 'Please provide your Visa or Mastercard number.'; break;
        case 'payeer': prompt = 'Please provide your Payeer Number (e.g., P12345678).'; break;
        case 'alipay': prompt = 'Please provide your Alipay email.'; break;
    }
    bot.sendMessage(chatId, prompt);
}

async function handlePaymentDetailsInput(chatId, details) {
    userSessions[chatId].paymentDetails = details;
    bot.sendMessage(chatId, "⏳ Thank you. Generating your deposit address, please wait...");

    const { amount, network } = userSessions[chatId];

    const transactionOptions = {
        currency1: network,
        currency2: network, // Keep this the same as currency1 for crypto deposits
        amount: amount,
        buyer_email: process.env.BUYER_REFUND_EMAIL,
        item_name: `Sell ${amount} ${network}`,
        // Add custom field to link transaction back to user
        custom: JSON.stringify({
            telegramChatId: chatId,
            paymentMethod: userSessions[chatId].paymentMethod,
            paymentDetails: userSessions[chatId].paymentDetails,
            fiat: userSessions[chatId].fiat
        })
    };

    try {
        const result = await coinpaymentsClient.createTransaction(transactionOptions);
        
        const depositInfo = `✅ **Deposit Address Generated!**\n\nPlease send exactly **${result.amount} ${network}** to the following address:\n\n\`${result.address}\`\n\nYour transaction ID is \`${result.txn_id}\`.\n\nOnce your deposit is confirmed, we will process your fiat payment. This transaction will be valid for **${result.timeout / 3600} hours**.`;

        bot.sendMessage(chatId, depositInfo, { parse_mode: 'Markdown' });
        // Optionally, send QR code
        if (result.qrcode_url) {
            bot.sendPhoto(chatId, result.qrcode_url, { caption: "You can also scan this QR code." });
        }
    } catch (error) {
        console.error("CoinPayments API Error:", error);
        bot.sendMessage(chatId, "❌ An error occurred while generating the deposit address. Please try again later by typing /start.");
    } finally {
        // Clean up the session
        delete userSessions[chatId];
    }
}
