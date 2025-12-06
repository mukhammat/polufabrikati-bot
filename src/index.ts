
import { Hono } from "hono";
import { webhookCallback, Bot, GrammyError } from 'grammy'
import { AppType } from "./types.js";
import { tBot } from "./t-bot.js";

// Bot
let bot: Bot;

// Start a Hono app
const app = new Hono<AppType>();

let init = false;

app.use(async (c, next) => {
	if(!init) {
		bot = new Bot(c.env.TELEGRAM_BOT_TOKEN);
		
		// Initialize the bot
		await tBot(bot, c);

		// Error handling
		bot.catch((error) => {
			// const ctx = error.ctx;
			if(error instanceof GrammyError) {
				console.error(
					`Grammy error while handling update ${error.message}:`
				);
			}
		});

		init = true;
	}
	await next();
});


// Webhook endpoint
app.post('/webhook', async (c) => {
	// await tBot(bot, c);
	return webhookCallback(bot, 'hono')(c);
});

// Endpoint to set the webhook
app.get('/set-webhook', async (c) => {
	console.log(c.env);
	const url = `${c.env.APP_URL}/webhook`;
	await bot.api.setWebhook(url);
	return c.text('Webhook set!');
});

export default app;
