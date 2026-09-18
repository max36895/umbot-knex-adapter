# umbot-knex-adapter

[![npm version](https://img.shields.io/npm/v/umbot-knex-adapter.svg)](https://www.npmjs.com/package/umbot-knex-adapter)
[![npm downloads](https://img.shields.io/npm/dm/umbot-knex-adapter.svg)](https://www.npmjs.com/package/umbot-knex-adapter)
[![license](https://img.shields.io/npm/l/umbot-knex-adapter.svg)](https://github.com/max36895/umbot-knex-adapter/blob/main/LICENSE.md)
[![umbot](https://img.shields.io/badge/umbot-adapter-blue)](https://github.com/max36895/universal_bot-ts)

> A robust, type-safe Knex.js database adapter for the [umbot](https://github.com/max36895/universal_bot-ts) framework.

`umbot-knex-adapter` seamlessly integrates [Knex.js](https://knexjs.org/) into your umbot application, allowing you to
work with relational databases (PostgreSQL, MySQL, SQLite, MSSQL) using a clean, promise-based API without bloating the
core framework with unnecessary SQL dependencies.

## ✨ Key Features

- 🚀 **Zero Core Bloat:** SQL dependencies are isolated in this plugin.
- 🗄️ **Multi-DB Support:** PostgreSQL, MySQL, MariaDB, SQLite, and MSSQL out of the box.
- 🔒 **Type-Safe:** Fully written in TypeScript with strict typings.
- 🔄 **Connection Pooling:** Built-in, configurable connection pooling for high-load bots.
- 🛡️ **Safe Queries:** `UPDATE` / `DELETE` without a `WHERE` clause are rejected; all values are passed as Knex
  bindings (no string concatenation).
- 🤖 **Umbot Native:** Implements the `BaseDbAdapter` contract, so `UsersData`, `ImageTokens`, `SoundTokens` and any
  custom `Model` work out of the box.

## 📋 Requirements

- Node.js `>= 20.19.0`
- `umbot >= 3.1.0` (peer dependency)
- `knex ^3.1.0` (peer dependency) + a driver for your database

## 📦 Installation

Install the adapter along with the `knex` query builder and your specific database driver:

```bash
# For PostgreSQL (Recommended)
npm install umbot umbot-knex-adapter knex pg
```

```bash
# For MySQL / MariaDB
npm install umbot umbot-knex-adapter knex mysql2
```

```bash
# For SQLite (Great for local dev or small bots)
npm install umbot umbot-knex-adapter knex better-sqlite3
```

## 🚀 Quick Start

Initialize the adapter and pass it to your umbot instance. Only one DB adapter can be active at a time — registering a
second one destroys the previous.

```ts
import { Bot } from 'umbot';
import { TelegramAdapter } from 'umbot/plugins';
import { KnexAdapter } from 'umbot-knex-adapter';

const bot = new Bot().use(new TelegramAdapter(process.env.TELEGRAM_TOKEN)).use(
    new KnexAdapter({
        host: 'localhost',
        database: 'my_bot_db',
        user: 'postgres',
        pass: 'super_secret_password',
        options: {
            client: 'pg', // 'pg', 'mysql2', 'better-sqlite3', 'mssql', ...
            port: 5432,
            pool: { min: 2, max: 10 },
            debug: false, // set to true to log every SQL query
        },
    }),
);

bot.start('0.0.0.0', 3000);
```

The connection itself is established lazily by the framework on the first request that needs the database.

### SQLite

For SQLite clients the `database` field is used as the file name:

```ts
new KnexAdapter({
    host: '',
    database: './bot.sqlite', // or ':memory:'
    options: { client: 'better-sqlite3' },
});
```

## ⚙️ Configuration Options

`options` is the `IAppDB.options` object; it accepts the following parameters:

| Parameter                | Type    | Default | Description                                                                      |
| ------------------------ | ------- | ------- | -------------------------------------------------------------------------------- |
| client                   | string  | 'pg'    | The database driver (`pg`, `mysql2`, `better-sqlite3`, `mssql`).                 |
| port                     | number  | Auto    | Database port. Auto-detected from the client if omitted. Ignored for SQLite.     |
| pool.min                 | number  | 2       | Minimum number of connections in the pool.                                       |
| pool.max                 | number  | 10      | Maximum number of connections in the pool.                                       |
| acquireConnectionTimeout | number  | 5000    | Timeout (ms) for acquiring a connection from the pool.                           |
| debug                    | boolean | false   | If true, logs all executed SQL queries to the console.                           |
| connection               | object  | {}      | Extra driver-specific connection parameters (merged into the Knex `connection`). |

## 🔍 Supported query operators

Conditions (`IQueryData`) accept plain values (equality) or an object with operators:

| Operator | Example                             | SQL                 |
| -------- | ----------------------------------- | ------------------- |
| —        | `{ userId: '123' }`                 | `userId = ?`        |
| `$gt`    | `{ age: { $gt: 18 } }`              | `age > ?`           |
| `$gte`   | `{ age: { $gte: 18 } }`             | `age >= ?`          |
| `$lt`    | `{ age: { $lt: 18 } }`              | `age < ?`           |
| `$lte`   | `{ age: { $lte: 18 } }`             | `age <= ?`          |
| `$ne`    | `{ status: { $ne: 'banned' } }`     | `status <> ?`       |
| `$in`    | `{ city: { $in: ['MSK', 'SPB'] } }` | `city in (?, ?)`    |
| `$nin`   | `{ city: { $nin: ['MSK'] } }`       | `city not in (?)`   |
| `$like`  | `{ name: { $like: 'John%' } }`      | `name like ?`       |
| `$null`  | `{ deletedAt: { $null: true } }`    | `deletedAt is null` |

Several operators on one field are combined with `AND`: `{ age: { $gt: 17, $lt: 40 } }`.

An unknown `$`-operator rejects the whole query (the adapter logs the reason and returns
`{ status: false }` / `false`) — silently degrading it to equality would touch the wrong rows.

```ts
import { UsersData } from 'umbot';

const model = new UsersData(ctx.appContext);
const res = await model.where({ platform: 'telegram' });
```

## 🧠 Using in Skills / Handlers

Standard umbot models work as usual:

```ts
import { Bot, UsersData } from 'umbot';

bot.addCommand('progress', ['прогресс'], async (_text, ctx) => {
    const userData = new UsersData(ctx.appContext);
    userData.userId = ctx.userId;

    if (await userData.getOne()) {
        ctx.text = `Прогресс: ${(userData.data as { progress?: number })?.progress ?? 0}%`;
    } else {
        userData.data = { progress: 0 };
        await userData.save();
        ctx.text = 'Добро пожаловать!';
    }
});
```

For arbitrary SQL use `model.query()` — the callback receives the live Knex instance
(as both `client` and `db`, Knex has a single entry point):

```ts
import type { Knex } from 'knex';

const rows = await model.query(async (_client: Knex, db: Knex) => {
    try {
        return { status: true, data: await db('users').where('age', '>', 18).count() };
    } catch (e) {
        return { status: false, error: e as Error };
    }
});
```

The raw Knex instance is also available in the app context:

```ts
import type { IKnexDbInfo } from 'umbot-knex-adapter';

const db = (ctx.appContext.database.databaseInfo as IKnexDbInfo).connection;
```

## 📐 Schema

The adapter does not create tables — bring your own migrations. Minimal schema for the built-in models:

```ts
await knex.schema.createTable('UsersData', (t) => {
    t.string('userId', 250).primary();
    t.text('meta');
    t.text('data');
    t.string('platform');
});

await knex.schema.createTable('ImageTokens', (t) => {
    t.string('imageToken', 150).primary();
    t.string('path', 150);
    t.string('platform');
});

await knex.schema.createTable('SoundTokens', (t) => {
    t.string('soundToken', 150).primary();
    t.string('path', 150);
    t.string('platform');
});
```

## ⚠️ Limitations

- `UPDATE` / `DELETE` with an empty `WHERE` are rejected (returns `false`, logs an error).
- `_select` returns `{ status: false }` when nothing was found — `status: true` always means there is data,
  as required by the umbot external-adapter contract.
- Nested / `$or` conditions are not supported: use `model.query()` for complex SQL.
- `escapeString()` returns the value as-is: Knex passes every value as a binding, so doubling quotes would
  corrupt the stored text instead of protecting anything.

## 🧪 Development & Testing

```bash
git clone https://github.com/max36895/umbot-knex-adapter.git
cd umbot-knex-adapter
npm install
npm run build
npm test
```

Tests run against in-memory SQLite (`better-sqlite3`) — no external database required.

## 🔗 Ecosystem

This package is part of the umbot ecosystem:

- [umbot](https://github.com/max36895/universal_bot-ts) — the core universal bot framework (Telegram, VK, web, etc.).
- umbot-knex-adapter — SQL database adapter (this package).

## 📄 License

MIT © Maxim-M
