import { BaseDbAdapter } from 'umbot/plugins';
import {
    IModelRes,
    TQueryCb,
    IQueryData,
    IQuery,
    Text,
    AppContext,
    IDatabaseInfo,
    IAppDB,
} from 'umbot';
import knex, { Knex } from 'knex';

/**
 * Информация о подключении, которую адаптер хранит в `appContext.database.databaseInfo`.
 */
export interface IKnexDbInfo extends IDatabaseInfo {
    /**
     * Живой инстанс Knex (пул соединений)
     */
    connection?: Knex;
    /**
     * Конфигурация, с которой был создан инстанс
     */
    config?: Knex.Config;
}

/**
 * Дополнительные опции подключения, передаются через `IAppDB.options`.
 */
export interface IKnexOptions {
    /**
     * Драйвер БД: `pg`, `mysql2`, `better-sqlite3`, `mssql` и т.д.
     */
    client?: string;
    /**
     * Порт БД. Если не указан — подставляется значение по умолчанию для драйвера.
     */
    port?: number;
    /**
     * Любые дополнительные параметры подключения драйвера (ssl, charset, filename и т.п.)
     */
    connection?: Record<string, unknown>;
    /**
     * Настройки пула соединений
     */
    pool?: {
        min?: number;
        max?: number;
    };
    /**
     * Логировать все SQL-запросы в консоль
     */
    debug?: boolean;
    /**
     * Таймаут получения соединения из пула, мс (по умолчанию 5000).
     * ТЗ внешних адаптеров требует ограниченных таймаутов у всех обращений к БД.
     */
    acquireConnectionTimeout?: number;
}

/**
 * Операторы условий, поддерживаемые адаптером.
 * Минимальный набор задан ТЗ внешних адаптеров umbot: `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`.
 * Дополнительно поддержаны `$nin`, `$like`, `$null`.
 */
const SUPPORTED_OPERATORS = [
    '$gt',
    '$gte',
    '$lt',
    '$lte',
    '$ne',
    '$in',
    '$nin',
    '$like',
    '$null',
] as const;

type TOperator = (typeof SUPPORTED_OPERATORS)[number];

/**
 * Ключи, через которые можно добраться до прототипа. В имени колонки их быть не может,
 * а их появление означает попытку прототипной инъекции — такой запрос отклоняется.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Адаптер для работы с реляционными базами данных через Knex.js.
 * Поддерживает PostgreSQL, MySQL, SQLite и другие СУБД через соответствующие драйверы.
 *
 * Все значения уходят в БД через биндинги Knex — конкатенации пользовательских
 * значений в SQL нет, поэтому дополнительное экранирование не требуется.
 */
export class KnexAdapter extends BaseDbAdapter<IKnexDbInfo> {
    dbFormat: string = 'knex';
    private db?: Knex;

    constructor(options?: IAppDB) {
        super(options);
    }

    init(appContext: AppContext): void {
        if (this._dbOptions) {
            const dbConfig = (appContext.appConfig.db ??= {
                host: '',
                user: '',
                pass: '',
                database: '',
            });
            dbConfig.host = this._dbOptions.host || dbConfig.host;
            dbConfig.database = this._dbOptions.database || dbConfig.database;
            // exactOptionalPropertyTypes: опциональные поля заполняем только реальными
            // значениями, не протаскивая undefined в конфиг приложения.
            const dbUser = this._dbOptions.user || dbConfig.user;
            if (dbUser !== undefined) {
                dbConfig.user = dbUser;
            }
            const dbPass = this._dbOptions.pass || dbConfig.pass;
            if (dbPass !== undefined) {
                dbConfig.pass = dbPass;
            }
            const dbOptions = this._dbOptions.options || dbConfig.options;
            if (dbOptions !== undefined) {
                dbConfig.options = dbOptions;
            }
        }
        super.init(appContext);
    }

    async connect(): Promise<boolean> {
        if (!this._appContext.appConfig.db) {
            this._saveLog('Отсутствуют данные для подключения к базе данных!');
            return false;
        }

        // Повторный connect() без закрытия старого пула оставлял висеть его
        // соединения: Knex не освобождает их при потере ссылки на инстанс.
        await this.#destroyPool();

        try {
            const config = this.buildKnexConfig();
            const db = knex(config);

            try {
                await db.raw('SELECT 1');
            } catch (error) {
                // Пул уже создан — закрываем его, иначе он висит до конца процесса.
                await db.destroy().catch(() => {});
                throw error;
            }

            this.db = db;
            const databaseInfo = (this._appContext.database.databaseInfo ??= {} as IKnexDbInfo);
            databaseInfo.connection = db;
            databaseInfo.config = config;

            this._appContext?.log('Успешное подключение к базе данных через Knex.js');
            return true;
        } catch (error) {
            this._saveLog('При подключении к базе данных произошла ошибка', error as Error);
            return false;
        }
    }

    private buildKnexConfig(): Knex.Config {
        const dbConfig = this._appContext.appConfig.db;
        if (!dbConfig) {
            throw new Error('Конфигурация базы данных не найдена');
        }

        const customOptions = (dbConfig.options || {}) as IKnexOptions;
        const client = customOptions.client || 'pg';

        const config: Knex.Config = {
            client,
            connection: {
                host: dbConfig.host,
                port: customOptions.port || this.getDefaultPort(client),
                user: dbConfig.user,
                password: dbConfig.pass,
                database: dbConfig.database,
                ...(customOptions.connection || {}),
            },
            pool: {
                min: customOptions.pool?.min ?? 2,
                max: customOptions.pool?.max ?? 10,
            },
            debug: customOptions.debug || false,
            // Без ограничения запрос к исчерпанному пулу висит бесконечно и блокирует
            // обработку вебхука (ТЗ: «все обращения к БД должны иметь ограниченные таймауты»).
            acquireConnectionTimeout: customOptions.acquireConnectionTimeout ?? 5000,
        };

        if (KnexAdapter.isSqliteClient(client)) {
            config.connection = {
                filename: dbConfig.database || ':memory:',
                // Драйвер-специфичные опции (например, filename ':memory:' или flags)
                // раньше терялись: sqlite-ветка затирала connection целиком.
                ...(customOptions.connection || {}),
            };
            config.useNullAsDefault = true;
        }

        return config;
    }

    /**
     * Является ли драйвер SQLite-совместимым (у него нет host/port, только файл).
     */
    private static isSqliteClient(client: string): boolean {
        return client === 'sqlite3' || client === 'sqlite' || client === 'better-sqlite3';
    }

    private getDefaultPort(client: string): number {
        const ports: Record<string, number> = {
            pg: 5432,
            postgresql: 5432,
            mysql: 3306,
            mysql2: 3306,
            sqlite3: 0,
            sqlite: 0,
            'better-sqlite3': 0,
            mssql: 1433,
        };
        return ports[client] || 5432;
    }

    /**
     * Переносит условия `IQueryData` в запрос Knex.
     *
     * Скалярное значение — равенство, объект — набор операторов (`{ age: { $gt: 18 } }`).
     * Неизвестный `$`-оператор отклоняет весь запрос: молчаливо превратить его в
     * равенство означало бы вернуть не те записи (а для UPDATE/DELETE — задеть не те).
     *
     * @param query Билдер Knex
     * @param where Условия выборки
     * @returns Билдер с применёнными условиями либо `null`, если условия некорректны
     */
    #applyWhere<TBuilder extends Knex.QueryBuilder>(
        query: TBuilder,
        where: IQueryData,
    ): TBuilder | null {
        let result = query;
        for (const field of Object.keys(where)) {
            if (FORBIDDEN_KEYS.has(field)) {
                this._saveLog(`Попытка использовать запрещённый ключ: ${field}`);
                return null;
            }
            const value = where[field];
            if (value === undefined) {
                // Knex падает на undefined-биндинге, а «условие», которого нет,
                // для UPDATE/DELETE опаснее ошибки: отклоняем запрос явно.
                this._saveLog(`Условие для поля "${field}" не задано (undefined).`);
                return null;
            }
            if (value === null) {
                result = result.whereNull(field) as TBuilder;
                continue;
            }
            if (typeof value !== 'object' || Array.isArray(value)) {
                result = result.where(field, value as Knex.Value) as TBuilder;
                continue;
            }

            const conditions = value as Record<string, unknown>;
            const keys = Object.keys(conditions);
            // Объект без операторов — не условие, а случайно переданная структура:
            // драйвер развернул бы её в невалидный SQL.
            if (!keys.length || !keys.every((key) => key.startsWith('$'))) {
                this._saveLog(
                    `Условие для поля "${field}" не содержит операторов. Поддерживаются: ${SUPPORTED_OPERATORS.join(', ')}.`,
                );
                return null;
            }
            for (const key of keys) {
                if (!(SUPPORTED_OPERATORS as readonly string[]).includes(key)) {
                    this._saveLog(
                        `Неизвестный оператор "${key}" для поля "${field}". Поддерживаются: ${SUPPORTED_OPERATORS.join(', ')}.`,
                    );
                    return null;
                }
                const applied = this.#applyOperator(
                    result,
                    field,
                    key as TOperator,
                    conditions[key],
                );
                if (!applied) {
                    return null;
                }
                result = applied;
            }
        }
        return result;
    }

    /**
     * Применяет один оператор условия к билдеру.
     * @returns Билдер либо `null`, если значение оператора некорректно
     */
    #applyOperator<TBuilder extends Knex.QueryBuilder>(
        query: TBuilder,
        field: string,
        operator: TOperator,
        value: unknown,
    ): TBuilder | null {
        switch (operator) {
            case '$gt':
                return query.where(field, '>', value as Knex.Value) as TBuilder;
            case '$gte':
                return query.where(field, '>=', value as Knex.Value) as TBuilder;
            case '$lt':
                return query.where(field, '<', value as Knex.Value) as TBuilder;
            case '$lte':
                return query.where(field, '<=', value as Knex.Value) as TBuilder;
            case '$ne':
                return value === null
                    ? (query.whereNotNull(field) as TBuilder)
                    : (query.whereNot(field, value as Knex.Value) as TBuilder);
            case '$like':
                return query.where(field, 'like', value as Knex.Value) as TBuilder;
            case '$null':
                return value
                    ? (query.whereNull(field) as TBuilder)
                    : (query.whereNotNull(field) as TBuilder);
            case '$in':
            case '$nin': {
                if (!Array.isArray(value)) {
                    this._saveLog(`Оператор "${operator}" для поля "${field}" ожидает массив.`);
                    return null;
                }
                return operator === '$in'
                    ? (query.whereIn(field, value as Knex.Value[]) as TBuilder)
                    : (query.whereNotIn(field, value as Knex.Value[]) as TBuilder);
            }
        }
    }

    /**
     * Выполняет SELECT-запрос.
     *
     * Контракт umbot: при `isOne` возвращается сама запись (не массив), а отсутствие
     * записей — это `{ status: false }`. Так работают встроенные адаптеры, и на это
     * опираются `Model.whereOne()` (наполнение state по именам полей) и
     * `BaseDbAdapter.save()` (выбор insert vs update).
     *
     * @param selectData Информация о таблице и структуре
     * @param where Условия выборки
     * @param isOne Вернуть только одну запись
     */
    public async _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean,
    ): Promise<IModelRes> {
        if (!this.db) {
            return { status: false, error: 'Нет подключения к базе данных' };
        }

        try {
            let query = this.db(selectData.tableName).select('*');
            if (where) {
                const applied = this.#applyWhere(query, where);
                if (!applied) {
                    return { status: false, error: 'Некорректные условия выборки' };
                }
                query = applied;
            }

            if (isOne) {
                const result = await query.first();
                // Запись не найдена — status: false (см. контракт выше).
                if (result === undefined || result === null) {
                    return { status: false };
                }
                return { status: true, data: result };
            }

            const result = await query;
            if (!result || !result.length) {
                return { status: false };
            }
            return { status: true, data: result };
        } catch (error) {
            this._saveLog('Ошибка при выполнении SELECT', error as Error);
            return { status: false, error: (error as Error).message };
        }
    }

    /**
     * Убирает поля со значением `undefined`.
     *
     * `Model.save()` кладёт в data все атрибуты модели, включая незаполненные
     * (например, `platform` у UsersData). Knex на таком значении падает с
     * «Undefined binding(s)» и роняет весь insert/update.
     */
    #withoutUndefined(data: IQueryData): IQueryData {
        const result: IQueryData = {};
        for (const key of Object.keys(data)) {
            if (data[key] !== undefined) {
                result[key] = data[key];
            }
        }
        return result;
    }

    public async _insert(insertData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const data = this.#withoutUndefined(this.validate(insertData, insertData.data));
            if (!Object.keys(data).length) {
                this._saveLog('Попытка выполнить INSERT без данных. Операция отменена.');
                return false;
            }
            await this.db(insertData.tableName).insert(data);
            return true;
        } catch (error) {
            this._saveLog('Ошибка при выполнении INSERT', error as Error);
            return false;
        }
    }

    public async _update(updateData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const data = this.#withoutUndefined(this.validate(updateData, updateData.data));
            if (!Object.keys(data).length) {
                this._saveLog('Попытка выполнить UPDATE без данных. Операция отменена.');
                return false;
            }
            const where = updateData.query;
            // Пустой WHERE обновил бы всю таблицу. Наличие primaryKeyName само по себе
            // условием не является — значение ключа должно лежать в query.
            if (!where || !Object.keys(where).length) {
                this._saveLog('Попытка выполнить UPDATE без условия WHERE. Операция отменена.');
                return false;
            }

            const query = this.#applyWhere(this.db(updateData.tableName), where);
            if (!query) {
                return false;
            }
            await query.update(data);
            return true;
        } catch (error) {
            this._saveLog('Ошибка при выполнении UPDATE', error as Error);
            return false;
        }
    }

    public async _remove(removeData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const where = removeData.query;
            // Пустой WHERE удалил бы всю таблицу — см. комментарий в _update().
            if (!where || !Object.keys(where).length) {
                this._saveLog('Попытка выполнить DELETE без условия WHERE. Операция отменена.');
                return false;
            }

            const query = this.#applyWhere(this.db(removeData.tableName), where);
            if (!query) {
                return false;
            }
            await query.del();
            return true;
        } catch (error) {
            this._saveLog('Ошибка при выполнении DELETE', error as Error);
            return false;
        }
    }

    /**
     * Выполняет произвольный запрос через callback.
     * В callback приходит один и тот же инстанс Knex и как client, и как db —
     * у Knex это единая точка входа (в отличие от Mongo, где client и db разные).
     */
    public async _query(callback: TQueryCb<Knex, Knex>): Promise<unknown | null> {
        if (!this.db) {
            this._saveLog('Нет подключения к базе данных');
            return null;
        }
        try {
            const data = await callback(this.db, this.db);
            if (data.status) {
                return data.data;
            }
            this._saveLog(String(data.error));
            return null;
        } catch (error) {
            this._saveLog((error as Error).message, error as Error);
            return null;
        }
    }

    public async query(callback: TQueryCb<Knex, Knex>): Promise<unknown | IModelRes> {
        return this._query(callback);
    }

    public async isConnected(): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            await this.db.raw('SELECT 1');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Закрывает пул и очищает ссылки на него в контексте приложения.
     * Безопасен к повторному вызову.
     */
    async #destroyPool(): Promise<void> {
        const db = this.db;
        this.db = undefined;
        const databaseInfo = this._appContext?.database?.databaseInfo;
        if (databaseInfo) {
            // Иначе в контексте остаётся ссылка на уничтоженный пул, и внешний код
            // (`databaseInfo.connection`) получает уже закрытое подключение.
            delete databaseInfo.connection;
            delete databaseInfo.config;
        }
        if (db) {
            try {
                await db.destroy();
            } catch (error) {
                this._saveLog('Ошибка при закрытии подключения Knex', error as Error);
            }
        }
    }

    public async destroy(): Promise<void> {
        await super.destroy();
        await this.#destroyPool();
    }

    /**
     * Валидация данных по правилам модели (`query.rules`).
     * Метод мутирует и возвращает `element`; при `element === null` возвращается `{}`.
     *
     * Поля, которых нет в данных, не трогаются: приведение отсутствующего значения
     * записывало бы в БД строку "undefined" или NaN.
     */
    public validate(query: IQuery, element: IQueryData | null): IQueryData {
        if (!element) {
            return {};
        }
        const rules = query.rules;
        if (rules) {
            rules.forEach((rule) => {
                let type = 'number';
                switch (rule.type) {
                    case 'string':
                    case 'text':
                        type = 'string';
                        break;
                    case 'int':
                    case 'integer':
                    case 'bool':
                        type = 'number';
                        break;
                }
                rule.name.forEach((data) => {
                    if (element[data] === undefined || element[data] === null) {
                        return;
                    }
                    if (type === 'string') {
                        element[data] = this.escapeString(element[data] as string);
                        if (rule.max !== undefined) {
                            element[data] = Text.resize(element[data] as string, rule.max);
                        }
                    } else {
                        element[data] = +(element[data] as number);
                    }
                });
            });
        }
        return element;
    }

    /**
     * Приводит значение к строке.
     *
     * Экранирования здесь намеренно нет: все значения уходят в БД биндингами Knex
     * (`?`-параметры), поэтому удвоение кавычек ни от чего не защитит, зато запишет
     * в таблицу искажённый текст (`O'Connor` → `O''Connor`).
     * @param str Значение
     * @returns Строковое представление
     */
    public escapeString(str: string | number): string {
        if (typeof str !== 'string') {
            return str + '';
        }
        return str;
    }

    protected _saveLog(errorMsg: string, error?: Error): void {
        this._appContext?.logError(`Knex: ${errorMsg}`, {
            error,
        });
    }
}
