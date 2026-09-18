import { KnexAdapter } from './../src';
import { AppContext, IQuery, UsersData } from 'umbot';
import type { Knex } from 'knex';

const emptyQuery = (tableName: string, primaryKeyName: string | null = 'id'): IQuery => ({
    tableName,
    query: null,
    data: null,
    primaryKeyName,
    rules: [],
});

describe('KnexAdapter', () => {
    let adapter: KnexAdapter;
    let mockAppContext: AppContext;

    const getDb = (): Knex => (adapter as unknown as { db: Knex }).db;

    beforeEach(() => {
        adapter = new KnexAdapter();
        mockAppContext = {
            appConfig: {
                db: {
                    host: 'localhost',
                    user: 'test',
                    pass: 'test',
                    database: ':memory:',
                    options: { client: 'better-sqlite3' },
                },
            },
            database: { databaseInfo: {} },
            log: jest.fn(),
            logError: jest.fn(),
        } as unknown as AppContext;
    });

    afterEach(async () => {
        await adapter.destroy();
    });

    describe('init & connect', () => {
        it('должен успешно инициализировать и подключиться к in-memory SQLite', async () => {
            adapter.init(mockAppContext);
            const result = await adapter.connect();
            expect(result).toBe(true);
            expect(mockAppContext.log).toHaveBeenCalledWith(
                expect.stringContaining('Успешное подключение'),
            );
        });

        it('должен вернуть false при отсутствии конфигурации', async () => {
            mockAppContext.appConfig.db = undefined as unknown as AppContext['appConfig']['db'];
            adapter.init(mockAppContext);
            const result = await adapter.connect();
            expect(result).toBe(false);
            expect(mockAppContext.logError).toHaveBeenCalled();
        });

        it('должен сохранить подключение в databaseInfo и очистить его при destroy', async () => {
            adapter.init(mockAppContext);
            await adapter.connect();
            const dbInfo = mockAppContext.database.databaseInfo as { connection?: unknown };
            expect(dbInfo.connection).toBeDefined();
            expect(await adapter.isConnected()).toBe(true);

            await adapter.destroy();
            expect(dbInfo.connection).toBeUndefined();
            expect(await adapter.isConnected()).toBe(false);
        });

        it('не должен терять connection-опции драйвера для SQLite', async () => {
            mockAppContext.appConfig.db!.database = 'ignored.sqlite';
            mockAppContext.appConfig.db!.options = {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
            };
            adapter.init(mockAppContext);
            expect(await adapter.connect()).toBe(true);

            const config = (mockAppContext.database.databaseInfo as { config?: Knex.Config })
                .config;
            expect((config?.connection as { filename: string }).filename).toBe(':memory:');
        });
    });

    describe('CRUD операции', () => {
        beforeEach(async () => {
            adapter.init(mockAppContext);
            await adapter.connect();
            const db = getDb();
            await db.schema.dropTableIfExists('users');
            await db.schema.createTable('users', (table) => {
                table.increments('id').primary();
                table.string('name');
                table.integer('age');
            });
        });

        it('_insert должен вернуть true при успешной вставке', async () => {
            const result = await adapter._insert({
                ...emptyQuery('users'),
                data: { name: 'John' },
            });
            expect(result).toBe(true);
        });

        it('_insert должен вернуть false, если данных нет', async () => {
            expect(await adapter._insert(emptyQuery('users'))).toBe(false);
        });

        it('_insert не должен падать на полях со значением undefined', async () => {
            const result = await adapter._insert({
                ...emptyQuery('users'),
                data: { name: 'John', age: undefined },
            });
            expect(result).toBe(true);
        });

        it('_select должен вернуть данные', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'John' } });
            const result = await adapter._select(emptyQuery('users'), { name: 'John' }, false);
            expect(result.status).toBe(true);
            expect(result.data).toHaveLength(1);
            expect((result.data as Record<string, unknown>[])[0].name).toBe('John');
        });

        it('_select(isOne) должен вернуть саму запись, а не массив', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'John' } });
            const result = await adapter._select(emptyQuery('users'), { name: 'John' }, true);
            expect(result.status).toBe(true);
            expect(Array.isArray(result.data)).toBe(false);
            expect((result.data as Record<string, unknown>).name).toBe('John');
        });

        it('_select должен вернуть status: false, если записей нет', async () => {
            expect(
                (await adapter._select(emptyQuery('users'), { name: 'Nope' }, true)).status,
            ).toBe(false);
            expect(
                (await adapter._select(emptyQuery('users'), { name: 'Nope' }, false)).status,
            ).toBe(false);
        });

        it('_update должен обновить запись по условию', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'John' } });
            const result = await adapter._update({
                ...emptyQuery('users'),
                query: { id: 1 },
                data: { name: 'Jane' },
            });
            expect(result).toBe(true);

            const selectRes = await adapter._select(emptyQuery('users'), { id: 1 }, true);
            expect((selectRes.data as Record<string, unknown>).name).toBe('Jane');
        });

        it('_update должен отказаться работать без WHERE', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'John' } });
            const result = await adapter._update({
                ...emptyQuery('users'),
                query: {},
                data: { name: 'Hacked' },
            });
            expect(result).toBe(false);

            const selectRes = await adapter._select(emptyQuery('users'), { id: 1 }, true);
            expect((selectRes.data as Record<string, unknown>).name).toBe('John');
        });

        it('_remove должен удалить запись', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'ToDelete' } });
            const result = await adapter._remove({
                ...emptyQuery('users'),
                query: { name: 'ToDelete' },
            });
            expect(result).toBe(true);

            const selectRes = await adapter._select(
                emptyQuery('users'),
                { name: 'ToDelete' },
                false,
            );
            expect(selectRes.status).toBe(false);
        });

        it('_remove должен отказаться работать без WHERE', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'Keep' } });
            expect(await adapter._remove({ ...emptyQuery('users'), query: {} })).toBe(false);

            const selectRes = await adapter._select(emptyQuery('users'), null, false);
            expect(selectRes.status).toBe(true);
        });

        describe('операторы условий', () => {
            beforeEach(async () => {
                await adapter._insert({
                    ...emptyQuery('users'),
                    data: { name: 'Alice', age: 17 },
                });
                await adapter._insert({ ...emptyQuery('users'), data: { name: 'Bob', age: 25 } });
                await adapter._insert({ ...emptyQuery('users'), data: { name: 'Carl', age: 40 } });
            });

            const names = (res: { data?: unknown }): string[] =>
                (res.data as Record<string, unknown>[]).map((row) => row.name as string).sort();

            it('$gt/$gte/$lt/$lte', async () => {
                expect(
                    names(await adapter._select(emptyQuery('users'), { age: { $gt: 17 } }, false)),
                ).toEqual(['Bob', 'Carl']);
                expect(
                    names(await adapter._select(emptyQuery('users'), { age: { $gte: 25 } }, false)),
                ).toEqual(['Bob', 'Carl']);
                expect(
                    names(await adapter._select(emptyQuery('users'), { age: { $lt: 25 } }, false)),
                ).toEqual(['Alice']);
                expect(
                    names(await adapter._select(emptyQuery('users'), { age: { $lte: 25 } }, false)),
                ).toEqual(['Alice', 'Bob']);
            });

            it('$ne и $in/$nin', async () => {
                expect(
                    names(await adapter._select(emptyQuery('users'), { age: { $ne: 25 } }, false)),
                ).toEqual(['Alice', 'Carl']);
                expect(
                    names(
                        await adapter._select(
                            emptyQuery('users'),
                            { name: { $in: ['Alice', 'Carl'] } },
                            false,
                        ),
                    ),
                ).toEqual(['Alice', 'Carl']);
                expect(
                    names(
                        await adapter._select(
                            emptyQuery('users'),
                            { name: { $nin: ['Alice', 'Carl'] } },
                            false,
                        ),
                    ),
                ).toEqual(['Bob']);
            });

            it('составное условие: несколько операторов на одно поле', async () => {
                expect(
                    names(
                        await adapter._select(
                            emptyQuery('users'),
                            { age: { $gt: 17, $lt: 40 } },
                            false,
                        ),
                    ),
                ).toEqual(['Bob']);
            });

            it('неизвестный оператор отклоняет запрос', async () => {
                const res = await adapter._select(
                    emptyQuery('users'),
                    { age: { $regex: '.*' } },
                    false,
                );
                expect(res.status).toBe(false);
                expect(mockAppContext.logError).toHaveBeenCalledWith(
                    expect.stringContaining('Неизвестный оператор'),
                    expect.anything(),
                );
            });

            it('$in без массива отклоняет запрос', async () => {
                const res = await adapter._select(emptyQuery('users'), { age: { $in: 25 } }, false);
                expect(res.status).toBe(false);
            });

            it('операторы работают в UPDATE и DELETE', async () => {
                expect(
                    await adapter._update({
                        ...emptyQuery('users'),
                        query: { age: { $lt: 18 } },
                        data: { name: 'Minor' },
                    }),
                ).toBe(true);
                expect(
                    names(await adapter._select(emptyQuery('users'), { name: 'Minor' }, false)),
                ).toEqual(['Minor']);

                expect(
                    await adapter._remove({
                        ...emptyQuery('users'),
                        query: { age: { $gte: 40 } },
                    }),
                ).toBe(true);
                expect(
                    (await adapter._select(emptyQuery('users'), { name: 'Carl' }, true)).status,
                ).toBe(false);
            });

            it('undefined в условии отклоняет запрос', async () => {
                const res = await adapter._update({
                    ...emptyQuery('users'),
                    query: { id: undefined },
                    data: { name: 'Hacked' },
                });
                expect(res).toBe(false);
            });

            it('запрещённые ключи отклоняются', async () => {
                const where = Object.defineProperty({}, '__proto__', {
                    value: 'x',
                    enumerable: true,
                }) as Record<string, unknown>;
                const res = await adapter._select(emptyQuery('users'), where, false);
                expect(res.status).toBe(false);
            });
        });
    });

    describe('_query', () => {
        beforeEach(async () => {
            adapter.init(mockAppContext);
            await adapter.connect();
            await getDb().schema.createTable('users', (table) => {
                table.increments('id').primary();
                table.string('name');
            });
        });

        it('должен отдать данные из callback', async () => {
            await adapter._insert({ ...emptyQuery('users'), data: { name: 'John' } });
            const res = await adapter.query(async (_client, db) => ({
                status: true,
                data: await db('users').select('name'),
            }));
            expect(res).toEqual([{ name: 'John' }]);
        });

        it('должен вернуть null при status: false', async () => {
            const res = await adapter.query(async () => ({ status: false, error: 'boom' }));
            expect(res).toBeNull();
        });

        it('должен вернуть null, если callback бросил исключение', async () => {
            const res = await adapter.query(async () => {
                throw new Error('boom');
            });
            expect(res).toBeNull();
        });
    });

    describe('интеграция с моделями umbot', () => {
        beforeEach(async () => {
            adapter.init(mockAppContext);
            await adapter.connect();
            await getDb().schema.createTable('UsersData', (table) => {
                table.string('userId').primary();
                table.text('meta');
                table.text('data');
                table.string('platform');
            });
        });

        it('whereOne должен наполнить state модели полями записи', async () => {
            await getDb()('UsersData').insert({ userId: 'u1', meta: '{}', data: '{"a":1}' });

            const model = new UsersData(mockAppContext);
            expect(await model.whereOne({ userId: 'u1' })).toBe(true);
            expect(model.userId).toBe('u1');
            expect(model.data).toEqual({ a: 1 });
        });

        it('save должен вставить новую запись и затем обновить её', async () => {
            const model = new UsersData(mockAppContext);
            model.userId = 'u2';
            model.data = { progress: 1 };
            expect(await model.save()).toBe(true);

            const inserted = await getDb()('UsersData').where({ userId: 'u2' }).first();
            expect(inserted.data).toBe('{"progress":1}');

            model.data = { progress: 2 };
            expect(await model.save()).toBe(true);

            const rows = await getDb()('UsersData').where({ userId: 'u2' });
            expect(rows).toHaveLength(1);
            expect(rows[0].data).toBe('{"progress":2}');
        });
    });

    describe('validate', () => {
        it('должен обрезать строку согласно rules и не искажать кавычки', () => {
            const query: IQuery = {
                ...emptyQuery('users'),
                rules: [{ name: ['name'], type: 'string', max: 5 }],
            };
            const element = { name: "O'Connor LongName" };
            const result = adapter.validate(query, element);
            // Значения уходят биндингами Knex, поэтому кавычка не удваивается.
            expect(result.name).toBe("O'...");
        });

        it('не должен трогать поля, которых нет в данных', () => {
            const query: IQuery = {
                ...emptyQuery('users'),
                rules: [
                    { name: ['name'], type: 'string', max: 5 },
                    { name: ['age'], type: 'integer' },
                ],
            };
            const result = adapter.validate(query, { other: 1 });
            expect('name' in result).toBe(false);
            expect('age' in result).toBe(false);
        });
    });
});
