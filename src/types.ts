import type { Context } from "hono";

export type Bindings = {
    KV: KVNamespace;
    APP_URL: string;
    TELEGRAM_BOT_TOKEN: string;
};

export type Variables = {
}

export type AppType = { Bindings: Bindings, Variables: Variables };

export type AppContext = Context<AppType>;