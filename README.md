# umbot-knex-adapter

[![npm version](https://img.shields.io/npm/v/umbot-knex-adapter.svg)](https://www.npmjs.com/package/umbot-knex-adapter)
[![npm downloads](https://img.shields.io/npm/dm/umbot-knex-adapter.svg)](https://www.npmjs.com/package/umbot-knex-adapter)
[![license](https://img.shields.io/npm/l/umbot-knex-adapter.svg)](https://github.com/max36895/umbot-knex-adapter/blob/main/LICENSE)
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
- 🛡️ **Safe Queries:** Prevents accidental mass `UPDATE`/`DELETE` operations.
- 🤖 **Umbot Native:** Perfectly integrates with `AppContext`, `BaseDbAdapter`, and umbot skills.

## 📦 Installation

Install the adapter along with the `knex` query builder and your specific database driver:

```bash
# For PostgreSQL (Recommended)
npm install umbot umbot-knex-adapter knex pg

# For MySQL / MariaDB
npm install umbot umbot-knex-adapter knex mysql2

# For SQLite (Great for local dev or small bots)
npm install umbot umbot-knex-adapter knex better-sqlite3
```

## 🚀 Quick Start

Initialize the adapter and pass it to your umbot instance.

```ts
import { Bot } from 'umbot';
import { KnexAdapter } from 'umbot-knex-adapter';

const bot = new Bot();

// 1. Initialize the Database Adapter
const dbAdapter = new KnexAdapter({
    host: 'localhost',
    database: 'my_bot_db',
    user: 'postgres',
    pass: 'super_secret_password',
    options: {
        client: 'pg', // 'pg', 'mysql2', 'better-sqlite3', etc.
        port: 5432,
        pool: { min: 2, max: 10 },
        debug: false, // Set to true to log all SQL queries
    },
});

// 2. Register it in the bot
bot.use(dbAdapter);
```

## ⚙️ Configuration Options

The options object in the adapter config accepts standard Knex parameters:

| Parameter  | Type    | Default | Description                                                  |
| ---------- | ------- | ------- | ------------------------------------------------------------ |
| client     | string  | 'pg'    | The database driver (pg, mysql2, better-sqlite3, mssql).     |
| port       | number  | Auto    | Database port. Auto-detected based on the client if omitted. |
| pool.min   | number  | 2       | Minimum number of connections in the pool.                   |
| pool.max   | number  | 10      | Maximum number of connections in the pool.                   |
| debug      | boolean | false   | If true, logs all executed SQL queries to the console.       |
| connection | object  | {}      | Any additional driver-specific connection parameters.        |

## 🧠 Using in Skills / Handlers

Once registered, the Knex instance is available in your umbot skills via the AppContext:

```ts
import { Bot, AppContext } from 'umbot';
import { KnexAdapter } from 'umbot/knex';

const bot = new Bot();
bot.use(new KnexAdapter());
```

## 🧪 Development & Testing

If you want to contribute to the adapter:

```bash
git clone https://github.com/max36895/umbot-knex-adapter.git
cd umbot-knex-adapter
npm install
npm run build
npm test
```

## 🔗 Ecosystem

This package is part of the umbot ecosystem:

- [umbot](https://github.com/max36895/universal_bot-ts) - The core universal bot framework (Telegram, VK, web, etc.).
- umbot-knex-adapter - SQL Database adapter (this package).

## 📄 License

MIT © Maxim-M
