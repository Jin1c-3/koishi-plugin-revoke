import { Bot, Context, Dict, remove, Schema, sleep, Time } from "koishi";

export const name = "revoke";

export interface Config {
  timeout?: number;
  self_revoke: boolean;
}

export const Config: Schema<Config> = Schema.object({
  timeout: Schema.natural()
    .role("ms")
    .default(Time.hour)
    .description("消息保留的时间。"),
  self_revoke: Schema.boolean().default(true).description("是否撤回命令本身"),
});

interface messageRecord {
  id: string;
  sender: string;
  bot: boolean;
}

export function apply(ctx: Context, { timeout, self_revoke }: Config) {
  ctx = ctx.guild();
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  const logger = ctx.logger("revoke");
  const recent: Dict<messageRecord[]> = {};

  const handleMessage = (session) => {
    const list = (recent[session.channelId] ||= []);
    list.unshift({
      id: session.messageId,
      sender: session.userId,
      bot: Boolean(ctx.bots[session.uid]),
    });
    ctx.setTimeout(
      () =>
        remove(list, {
          id: session.messageId,
          sender: session.userId,
          bot: Boolean(ctx.bots[session.uid]),
        }),
      timeout
    );
  };

  ctx.on("message", handleMessage);
  ctx.on("send", handleMessage);

  ctx
    .command("revoke [count:number]", { authority: 2, captureQuote: false })
    .option("bot", "-b")
    .action(async ({ session, options }, count = 1) => {
      const list = recent[session.channelId];
      if (session.quote) {
        await revokeMessage(session, list, session.quote.id);
        if (self_revoke) {
          await revokeMessage(session, list, session.messageId);
        }
        return;
      }
      if (!list) return session.text(".no-msg");
      let removal: messageRecord[];
      if (options.bot) {
        removal = list
          .filter((messageRecord) => messageRecord.bot)
          .slice(0, count);
        removal.forEach((messageRecord) => remove(list, messageRecord));
      } else {
        removal = list.splice(1, count);
      }
      const delay = ctx.root.config.delay.broadcast;
      if (!list.length) delete recent[session.channelId];
      for (let index = 0; index < removal.length; index++) {
        if (index && delay) await sleep(delay);
        await deleteMessage(session.bot, session.channelId, removal[index].id);
      }
      if (self_revoke) {
        await revokeMessage(session, list, session.messageId);
      }
    });

  async function revokeMessage(
    session,
    list: messageRecord[],
    messageId: string
  ) {
    const index = list?.findIndex(
      (messageRecord) => messageRecord.id === messageId
    );
    if (index !== -1) {
      list.splice(index, 1);
    }
    await deleteMessage(session.bot, session.channelId, messageId);
  }

  async function deleteMessage(bot: Bot, channelId: string, messageId: string) {
    try {
      await bot.deleteMessage(channelId, messageId);
    } catch (error) {
      logger.warn(error);
    }
  }
}
