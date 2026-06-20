import { KnexAdapter } from './../src';
import { AppContext, IQuery } from 'umbot';

describe('KnexAdapter', () => {
    let adapter: KnexAdapter;
    let mockAppContext: AppContext;

    beforeEach(() => {
        adapter = new KnexAdapter();
        mockAppContext = {
            appConfig: {
                db: {
                    host: 'localhost',
                    user: 'test',
                    pass: 'test',
                    database: 'testdb',
                    options: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
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
    });

    describe('CRUD операции', () => {
        beforeEach(async () => {
            adapter.init(mockAppContext);
            await adapter.connect();
            const db = (adapter as unknown as { db: import('knex').Knex }).db;
            await db.schema.dropTableIfExists('users');
            await db.schema.createTable('users', (table) => {
                table.increments('id').primary();
                table.string('name');
            });
        });

        it('_insert должен вернуть true при успешной вставке', async () => {
            const result = await adapter._insert({
                tableName: 'users',
                query: null,
                data: { name: 'John' },
                primaryKeyName: 'id',
                rules: [],
            });
            expect(result).toBe(true);
        });

        it('_select должен вернуть данные', async () => {
            await adapter._insert({
                tableName: 'users',
                query: null,
                data: { name: 'John' },
                primaryKeyName: 'id',
                rules: [],
            });
            const result = await adapter._select(
                { tableName: 'users', query: null, data: null, primaryKeyName: 'id', rules: [] },
                { name: 'John' },
                false,
            );
            expect(result.status).toBe(true);
            expect(result.data).toHaveLength(1);
            expect((result.data as Record<string, unknown>[])[0].name).toBe('John');
        });

        it('_update должен обновить запись по primaryKeyName', async () => {
            await adapter._insert({
                tableName: 'users',
                query: null,
                data: { name: 'John' },
                primaryKeyName: 'id',
                rules: [],
            });
            const result = await adapter._update({
                tableName: 'users',
                query: { id: 1 },
                data: { name: 'Jane' },
                primaryKeyName: 'id',
                rules: [],
            });
            expect(result).toBe(true);

            const selectRes = await adapter._select(
                { tableName: 'users', query: null, data: null, primaryKeyName: 'id', rules: [] },
                { id: 1 },
                true,
            );
            expect((selectRes.data as Record<string, unknown>[])[0].name).toBe('Jane');
        });

        it('_remove должен удалить запись', async () => {
            await adapter._insert({
                tableName: 'users',
                query: null,
                data: { name: 'ToDelete' },
                primaryKeyName: 'id',
                rules: [],
            });
            const result = await adapter._remove({
                tableName: 'users',
                query: { name: 'ToDelete' },
                data: null,
                primaryKeyName: 'id',
                rules: [],
            });
            expect(result).toBe(true);

            const selectRes = await adapter._select(
                { tableName: 'users', query: null, data: null, primaryKeyName: 'id', rules: [] },
                { name: 'ToDelete' },
                false,
            );
            expect(selectRes.status).toBe(true);
            expect(selectRes.data).toHaveLength(0);
        });
    });

    describe('validate', () => {
        it('должен обрезать строку и экранировать кавычки согласно rules', () => {
            const query: IQuery = {
                tableName: 'users',
                query: null,
                data: null,
                primaryKeyName: 'id',
                rules: [{ name: ['name'], type: 'string', max: 5 }],
            };
            const element = { name: "O'Connor LongName" };
            const result = adapter.validate(query, element);
            expect(result.name).toBe("O'...");
        });
    });
});
