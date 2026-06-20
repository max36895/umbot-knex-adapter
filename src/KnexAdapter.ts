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

export interface IKnexDbInfo extends IDatabaseInfo {
    connection?: Knex;
    config?: Knex.Config;
}

interface IKnexOptions {
    client?: string;
    port?: number;
    connection?: Record<string, unknown>;
    pool?: {
        min?: number;
        max?: number;
    };
    debug?: boolean;
}

/**
 * Адаптер для работы с реляционными базами данных через Knex.js.
 * Поддерживает PostgreSQL, MySQL, SQLite и другие СУБД через соответствующие драйверы.
 */
export class KnexAdapter extends BaseDbAdapter<IKnexDbInfo> {
    dbFormat: string = 'knex';
    private db?: Knex;

    constructor(options?: IAppDB) {
        super(options);
    }

    init(appContext: AppContext): void {
        if (this._dbOptions) {
            appContext.appConfig.db ??= { host: '', user: '', pass: '', database: '' };
            appContext.appConfig.db.options =
                this._dbOptions.options || appContext.appConfig.db?.options;
            appContext.appConfig.db.host = this._dbOptions.host || appContext.appConfig.db?.host;
            appContext.appConfig.db.user = this._dbOptions.user || appContext.appConfig.db?.user;
            appContext.appConfig.db.pass = this._dbOptions.pass || appContext.appConfig.db?.pass;
            appContext.appConfig.db.database =
                this._dbOptions.database || appContext.appConfig.db?.database;
        }
        super.init(appContext);
    }

    async connect(): Promise<boolean> {
        if (!this._appContext.appConfig.db) {
            this._appContext?.logError('Отсутствуют данные для подключения к базе данных!');
            return false;
        }

        try {
            const config = this.buildKnexConfig();
            this.db = knex(config);

            await this.db.raw('SELECT 1');

            if (this._appContext.database.databaseInfo) {
                this._appContext.database.databaseInfo.connection = this.db;
                this._appContext.database.databaseInfo.config = config;
            }

            this._appContext?.log('Успешное подключение к базе данных через Knex.js');
            return true;
        } catch (error) {
            this._appContext?.logError('При подключении к базе данных произошла ошибка:', {
                error: (error as Error).message,
            });
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
        const isSqlite = client === 'sqlite3' || client === 'sqlite' || client === 'better-sqlite3';

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
                min: customOptions.pool?.min || 2,
                max: customOptions.pool?.max || 10,
            },
            debug: customOptions.debug || false,
        };

        if (isSqlite) {
            config.connection = { filename: dbConfig.database || ':memory:' };
            config.useNullAsDefault = true;
        }

        return config;
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
                query = query.where(where);
            }

            if (isOne) {
                const result = await query.first();
                return {
                    status: result !== undefined,
                    data: result !== undefined ? [result] : [],
                };
            }

            const result = await query;
            return { status: true, data: result || [] };
        } catch (error) {
            this._appContext?.logError('Ошибка при выполнении SELECT:', {
                error: (error as Error).message,
            });
            return { status: false, error: (error as Error).message };
        }
    }

    public async _insert(insertData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const data = this.validate(insertData, insertData.data);
            await this.db(insertData.tableName).insert(data);
            return true;
        } catch (error) {
            this._appContext?.logError('Ошибка при выполнении INSERT:', {
                error: (error as Error).message,
            });
            return false;
        }
    }

    public async _update(updateData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const data = this.validate(updateData, updateData.data);
            const where = updateData.query || {};
            if (Object.keys(where).length === 0 && !updateData.primaryKeyName) {
                this._appContext?.logError(
                    'Попытка выполнить UPDATE без условия WHERE. Операция отменена.',
                );
                return false;
            }

            if (
                updateData.primaryKeyName &&
                updateData.query &&
                updateData.query[updateData.primaryKeyName] !== undefined
            ) {
                await this.db(updateData.tableName)
                    .where(
                        updateData.primaryKeyName as string,
                        updateData.query[updateData.primaryKeyName] as string | number,
                    )
                    .update(data);
            } else {
                await this.db(updateData.tableName).where(where).update(data);
            }
            return true;
        } catch (error) {
            this._appContext?.logError('Ошибка при выполнении UPDATE:', {
                error: (error as Error).message,
            });
            return false;
        }
    }

    public async _remove(removeData: IQuery): Promise<boolean> {
        if (!this.db) {
            return false;
        }
        try {
            const where = removeData.query || {};
            if (Object.keys(where).length === 0 && !removeData.primaryKeyName) {
                this._appContext?.logError(
                    'Попытка выполнить UPDATE без условия WHERE. Операция отменена.',
                );
                return false;
            }

            if (
                removeData.primaryKeyName &&
                removeData.query &&
                removeData.query[removeData.primaryKeyName] !== undefined
            ) {
                await this.db(removeData.tableName)
                    .where(
                        removeData.primaryKeyName as string,
                        removeData.query[removeData.primaryKeyName] as string | number,
                    )
                    .del();
            } else {
                await this.db(removeData.tableName).where(where).del();
            }
            return true;
        } catch (error) {
            this._appContext?.logError('Ошибка при выполнении DELETE:', {
                error: (error as Error).message,
            });
            return false;
        }
    }

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

    public async destroy(): Promise<void> {
        await super.destroy();
        if (this.db) {
            try {
                await this.db.destroy();
                this.db = undefined;
            } catch (error) {
                this._appContext?.logError('Ошибка при закрытии подключения Knex:', {
                    error: (error as Error).message,
                });
            }
        }
    }

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
                    if (type === 'string') {
                        if (rule.max !== undefined && typeof element[data] === 'string') {
                            element[data] = Text.resize(element[data] as string, rule.max);
                        }
                        element[data] = this.escapeString(element[data] as string);
                    } else {
                        element[data] = +(element[data] as number);
                    }
                });
            });
        }
        return element;
    }

    public escapeString(str: string | number): string {
        if (typeof str !== 'string') {
            return str + '';
        }
        return str; //.replace(/'/g, "''");
    }

    protected _saveLog(errorMsg: string, error?: Error): void {
        this._appContext?.logError(`Knex: ${errorMsg}`, {
            error,
        });
    }
}
