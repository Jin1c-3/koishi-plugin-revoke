import {
  Bot,
  Context,
  Dict,
  remove,
  Schema,
  sleep,
  Time,
  h,
  Session,
} from "koishi";
import {} from "koishi-plugin-adapter-onebot";

export const name = "revoke";

export interface Config {
  timeout?: number;
  self_revoke: boolean;
}

export const Config: Schema<Config> = Schema.object({
  timeout: Schema.natural().role("ms").default(Time.hour),
  self_revoke: Schema.boolean().default(true),
}).i18n({ "zh-CN": require("./locales/zh-CN")._config });

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

  const handleMessage = (session: Session) => {
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
    .option("user", "-u <user>")
    .option("seq", "-s")
    .action(async ({ session, options }, count = 1) => {
      const list = recent[session.channelId];
      if (session.quote && !options.seq) {
        await revokeMessage(session, list, session.quote.id);
        if (self_revoke) {
          await revokeMessage(session, list, session.messageId);
        }
        return;
      }
      if (options.seq && !session.quote) {
        return session.text(".no-quote");
      }
      let modified_list = list;
      if (options.seq && session.quote) {
        const command = list[0];
        modified_list = list.slice(
          list.findIndex(
            (messageRecord) => messageRecord.id === session.quote.id
          )
        );
        modified_list.unshift(command);
      }
      if (!modified_list) return session.text(".no-msg");
      let removal: messageRecord[];
      if (options.bot) {
        removal = modified_list
          .filter((messageRecord) => messageRecord.bot)
          .slice(0, count);
        removal.forEach((messageRecord) => remove(list, messageRecord));
      } else if (options.user) {
        const parsedUser = h.parse(options.user)[0];
        if (parsedUser?.type === "at") {
          const { id } = parsedUser.attrs;
          if (!id) {
            return session.text(".wrong-user");
          }
          removal = modified_list
            .filter((messageRecord) => messageRecord.sender === id)
            .slice(0, count);
        } else {
          return session.text(".wrong-user");
        }
      } else {
        removal = modified_list.splice(1, count);
      }
      const delay = ctx.root.config.delay.broadcast;
      if (!modified_list.length) delete recent[session.channelId];
      for (let index = 0; index < removal.length; index++) {
        if (index && delay) await sleep(delay);
        await deleteMessage(session.bot, session.channelId, removal[index].id);
      }
      if (self_revoke) {
        await revokeMessage(session, list, session.messageId);
      }
    });

  async function revokeMessage(
    session: Session,
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

  ctx
    .command("set-essence [back_count:natural]", {
      authority: 3,
      captureQuote: false,
    })
    .option("bot", "-b")
    .option("origin", "-o")
    .action(async ({ session, options }, back_count = 1) => {
      if (session.quote) {
        await session.bot.internal.setEssenceMsg(session.quote.id);
        return;
      }
      const list = recent[session.channelId];
      if (!list) return session.text(".no-msg");
      if (options.origin) {
        await session.bot.internal.setEssenceMsg(back_count);
        return;
      }
      back_count--;
      if (options.bot) {
        await session.bot.internal.setEssenceMsg(
          list.filter((msg) => msg.bot)[back_count].id
        );
        return;
      }
      await session.bot.internal.setEssenceMsg(list[back_count].id);
      return;
    });

  ctx
    .command("del-essence [index:natural]", { authority: 3 })
    .option("origin", "-o")
    .action(async ({ session, options }, index = 1) => {
      if (session.quote) {
        await session.bot.internal.deleteEssenceMsg(session.quote.id);
        return;
      }
      const list = await session.bot.internal.getEssenceMsgList(session.guildId);
      if (!list) return session.text(".no-msg");
      if (index > list.length) return session.text(".too_big");
      if (options.origin) {
        await session.bot.internal.deleteEssenceMsg(index);
        return;
      }
      index--;
      await session.bot.internal.deleteEssenceMsg(list[index].message_id);
      return;
    });

  ctx
    .command("get-msgid [index:natural]", { authority: 2, captureQuote: false })
    .option("bot", "-b")
    .action(async ({ session, options }, index = 1) => {
      if (session.quote) {
        return session.quote.id;
      }
      const list = recent[session.channelId];
      if (!list) return session.text(".no-msg");
      if (options.bot) {
        return list.filter((msg) => msg.bot)[index - 1].id;
      }
      return list[index - 1].id;
    });
}
