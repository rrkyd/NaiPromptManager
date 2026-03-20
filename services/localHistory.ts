
import { LocalGenItem, NAIParams } from '../types';

const DB_NAME = 'NAI_History_DB';
const STORE_NAME = 'generations';
const DB_VERSION = 1;

class LocalHistoryService {
    private db: IDBDatabase | null = null;

    private async open(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    async add(imageUrl: string, prompt: string, params: NAIParams): Promise<void> {
        const db = await this.open();
        const item: LocalGenItem = {
            id: crypto.randomUUID(),
            imageUrl,
            prompt,
            params,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(item);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(): Promise<LocalGenItem[]> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            // Get latest first
            const request = index.openCursor(null, 'prev'); 
            const results: LocalGenItem[] = [];

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id: string): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async clear(): Promise<void> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 分页查询历史记录
     * @param page 页码（从0开始）
     * @param pageSize 每页数量
     * @returns 当前页的记录数组
     */
    async getPage(page: number, pageSize: number): Promise<LocalGenItem[]> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            
            // 计算跳过的数量
            const skipCount = page * pageSize;
            const results: LocalGenItem[] = [];
            let skipped = 0;
            
            // 从最新记录开始遍历
            const request = index.openCursor(null, 'prev');
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor && results.length < pageSize) {
                    if (skipped < skipCount) {
                        skipped++;
                        cursor.continue();
                    } else {
                        results.push(cursor.value);
                        cursor.continue();
                    }
                } else {
                    resolve(results);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取历史记录总数
     * @returns 记录总数
     */
    async getCount(): Promise<number> {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.count();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

export const localHistory = new LocalHistoryService();
