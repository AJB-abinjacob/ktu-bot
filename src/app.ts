import { Telegraf } from "telegraf";
import "dotenv/config";
import start from "./commands/start";
import help from "./commands/help";
import cancel from "./commands/cancel";
import result from "./commands/result";
import code from "./commands/code";
import notifications from "./commands/notifications";
import subscribe from "./commands/subscribe";
import unsubscribe from "./commands/unsubscribe";
import defaultHandler from "./commands/defaultHandler";
import { Scenes, session } from "telegraf";
import resultWizard from "./scenes/resultWizard";
import announcementWizard from "./scenes/announcementWizard";
import { CustomContext } from "./types/customContext.type";
import availableCommands from "./constants/availableCommands";
import { initDb } from "./db/initDb";
import notifyUserCron from "./cron/notifyUserCron";

const db = initDb();

const bot = new Telegraf<CustomContext>(process.env.BOT_TOKEN!);
const stage = new Scenes.Stage<CustomContext>([
  resultWizard,
  announcementWizard,
]);

bot.use(session());
bot.use(stage.middleware());

bot.telegram.setMyCommands(availableCommands);

bot.start((ctx) => start(ctx));
bot.command("help", (ctx) => help(ctx));
bot.command("result", (ctx) => result(ctx));
bot.command("code", (ctx) => code(ctx));
bot.command("cancel", (ctx) => cancel(ctx));
bot.command("notifications", (ctx) => notifications(ctx));
bot.command("subscribe", (ctx) => subscribe(ctx, db));
bot.command("unsubscribe", (ctx) => unsubscribe(ctx, db));
bot.on("message", (ctx) => defaultHandler(ctx));

const launchBot = async () => {
  bot.launch();
  if (bot)
    bot.telegram.getMe().then((res) => {
      console.log(`Bot started on https://t.me/${res.username}`);
      notifyUserCron(db, bot);
    });
};

launchBot();

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
