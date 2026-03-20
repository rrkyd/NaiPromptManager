
import React, { useState, useEffect } from 'react';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import { LocalGenItem, User } from '../types';
import { PAGINATION_CONFIG } from '../config/pagination';

interface GenHistoryProps {
    currentUser: User;
    notify: (msg: string, type?: 'success' | 'error') => void;
}

const UC_LABELS: Record<number, string> = {
    0: 'Heavy (0)',
    1: 'Light (1)',
    2: 'Furry (2)',
    3: 'Human (3)',
    4: 'None (4)'
};

const ParamItem = ({ label, value }: { label: string, value: React.ReactNode }) => (
    <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700/50">
        <div className="text-[10px] text-gray-400 uppercase font-bold text-ellipsis overflow-hidden mb-0.5">{label}</div>
        <div className="text-xs font-mono text-gray-800 dark:text-gray-200 font-medium truncate" title={String(value)}>{value}</div>
    </div>
);

export const GenHistory: React.FC<GenHistoryProps> = ({ currentUser, notify }) => {
    const [items, setItems] = useState<LocalGenItem[]>([]);
    const [lightbox, setLightbox] = useState<LocalGenItem | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishTitle, setPublishTitle] = useState('');
    const [showSuccessModal, setShowSuccessModal] = useState(false);

    // 分页相关状态
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    
    // 缓存管理
    const [pageCache, setPageCache] = useState<Record<number, LocalGenItem[]>>({});

    // 清理相关状态
    const [showCleanMenu, setShowCleanMenu] = useState(false);
    const [showCleanModal, setShowCleanModal] = useState(false);
    const [cleanMode, setCleanMode] = useState<'days' | 'count'>('days');
    const [cleanDays, setCleanDays] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_DAYS);
    const [cleanCount, setCleanCount] = useState<number>(PAGINATION_CONFIG.CLEANUP.DEFAULT_COUNT);
    const [cleanPreviewCount, setCleanPreviewCount] = useState(0);

    useEffect(() => {
        goToPage(1);
    }, []);

    const { PAGE_SIZE, MAX_CACHED_PAGES } = PAGINATION_CONFIG;

    // 内存管理：估算单条记录大小（字节）
    const estimateItemSize = (item: LocalGenItem): number => {
        // 基础字段大小估算
        const baseSize = 100; // id, createdAt等基础字段
        const promptSize = (item.prompt?.length || 0) * 2; // UTF-16编码
        // base64 图片通常是 ASCII 字符（1字节/字符），不是 UTF-16
        const imageUrlSize = (item.imageUrl?.length || 0) * 1;
        const paramsSize = JSON.stringify(item.params || {}).length * 2;
        return baseSize + promptSize + imageUrlSize + paramsSize;
    };

    // 内存管理：检查缓存大小是否合理
    const checkMemoryUsage = (items: LocalGenItem[]): boolean => {
        const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB最大缓存
        let totalSize = 0;
        for (const item of items) {
            totalSize += estimateItemSize(item);
            if (totalSize > MAX_CACHE_SIZE) {
                console.warn('缓存大小超过限制，执行清理');
                return false;
            }
        }
        return true;
    };

    // 获取页面数据（优先从缓存）
    const getPageData = async (page: number): Promise<LocalGenItem[]> => {
        // 检查缓存
        if (pageCache[page]) {
            return pageCache[page];
        }
        
        // 从数据库加载
        const data = await localHistory.getPage(page - 1, PAGE_SIZE);
        return data;
    };

    // 更新缓存并清理过远的缓存（仅在 goToPage 中调用，基于当前显示页清理）
    const updateCacheAndClean = (currentPage: number, data: LocalGenItem[]) => {
        // 定义需要保留的页码范围（当前页 ± 1 页）
        const validPages = [currentPage - 1, currentPage, currentPage + 1].filter(p => p >= 1);
        
        setPageCache(prev => {
            const newCache: Record<number, LocalGenItem[]> = {};
            
            // 保留有效范围内的已缓存数据
            validPages.forEach(p => {
                if (prev[p]) {
                    newCache[p] = prev[p];
                }
            });
            
            // 添加当前页的新数据
            newCache[currentPage] = data;
            
            console.log(`[缓存更新+清理] 当前页 ${currentPage}，有效范围: ${validPages.join(',')}，缓存:`, Object.keys(newCache).map(Number).sort());
            return newCache;
        });
    };

    // 仅添加缓存，不清理其他页面（在预加载中调用）
    const addCache = (page: number, data: LocalGenItem[]) => {
        setPageCache(prev => {
            // 如果已经有缓存，不重复添加
            if (prev[page]) {
                return prev;
            }
            console.log(`[缓存添加] 页码 ${page}`);
            return {
                ...prev,
                [page]: data
            };
        });
    };

    // 跳转到指定页
    const goToPage = async (page: number, force: boolean = false) => {
        if (isLoading) return;
        
        // 计算总页数
        const count = await localHistory.getCount();
        const calculatedTotalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
        
        // 边界检查
        const targetPage = Math.max(1, Math.min(page, calculatedTotalPages));
        
        // 如果不是强制刷新，且目标页与当前页相同，则跳过
        if (!force && targetPage === currentPage && items.length > 0) return;
        
        setIsLoading(true);
        setCurrentPage(targetPage);
        setTotalPages(calculatedTotalPages);
        setTotalCount(count);
        
        try {
            // 获取页面数据
            const data = await getPageData(targetPage);
            setItems(data);
            
            // 更新缓存并清理
            updateCacheAndClean(targetPage, data);
            
            // 预加载相邻页面（当前页 +1 和 -1）
            if (targetPage > 1) {
                loadPage(targetPage - 1);
            }
            if (targetPage < calculatedTotalPages) {
                loadPage(targetPage + 1);
            }
            
        } catch (e) {
            console.error('加载页面失败:', e);
            notify('加载失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // 加载指定页（用于预加载，不阻塞主流程）
    const loadPage = async (page: number) => {
        // 只检查缓存是否存在，不检查 isLoading（预加载不应被主加载阻塞）
        if (pageCache[page]) return;
        
        try {
            const data = await localHistory.getPage(page - 1, PAGE_SIZE);
            addCache(page, data);
            console.log(`[预加载] 页码 ${page} 完成`);
        } catch (e) {
            console.warn('预加载页面失败:', e);
        }
    };

    // 生成页码按钮
    const getPageButtons = (): number[] => {
        const buttons: number[] = [];
        const maxButtons = 7; // 最多显示7个页码按钮
        
        if (totalPages <= maxButtons) {
            // 总页数较少，显示所有页码
            for (let i = 1; i <= totalPages; i++) {
                buttons.push(i);
            }
        } else {
            // 总页数较多，显示当前页附近的页码
            const start = Math.max(1, currentPage - 3);
            const end = Math.min(totalPages, start + maxButtons - 1);
            
            for (let i = start; i <= end; i++) {
                buttons.push(i);
            }
        }
        
        return buttons;
    };

    const getDownloadFilename = () => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        return `NAI-${timestamp}.png`;
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('确定删除这张图片记录吗？(无法恢复)')) {
            await localHistory.delete(id);
            if (lightbox?.id === id) setLightbox(null);
            goToPage(currentPage);
        }
    };

    const handleClearAll = async () => {
        if (confirm('确定清空所有本地生图历史吗？')) {
            await localHistory.clear();
            setItems([]);
            setTotalCount(0);
            setShowCleanMenu(false);
        }
    };

    const handleCleanMenuClick = (mode: 'days' | 'count') => {
        setCleanMode(mode);
        setShowCleanMenu(false);
        setShowCleanModal(true);
        
        // 预览将删除的数量
        if (mode === 'days') {
            localHistory.countOlderThan(cleanDays).then(setCleanPreviewCount);
        } else {
            localHistory.getCount().then(count => {
                setCleanPreviewCount(Math.max(0, count - cleanCount));
            });
        }
    };

    const handleCleanConfirm = async () => {
        try {
            if (cleanMode === 'days') {
                await localHistory.deleteOlderThan(cleanDays);
            } else {
                await localHistory.keepOnly(cleanCount);
            }
            setShowCleanModal(false);
            goToPage(1); // 重新加载第一页
            notify('清理完成');
        } catch (e: any) {
            notify('清理失败: ' + e.message, 'error');
        }
    };

    const handlePublish = async () => {
        if (!lightbox) return;
        if (!publishTitle.trim()) {
            notify('请输入标题', 'error');
            return;
        }
        setIsPublishing(true);
        try {
            await db.saveInspiration({
                id: crypto.randomUUID(),
                title: publishTitle,
                imageUrl: lightbox.imageUrl,
                prompt: lightbox.prompt,
                userId: currentUser.id,
                username: currentUser.username,
                createdAt: Date.now()
            });
            notify('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            notify('发布成功！已加入灵感图库');
            setIsPublishing(false);
            setPublishTitle('');
            setLightbox(null); // Close lightbox
            setShowSuccessModal(true); // Show Success Modal
        } catch (e: any) {
            notify('发布失败: ' + e.message, 'error');
            setIsPublishing(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
            <header className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-md border-b border-gray-200 dark:border-gray-700 z-10 flex-shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">本地生图历史</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400">仅存储在您的浏览器中</p>
                    </div>
                    <div className="flex gap-2 md:gap-3 items-center">
                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">共 {totalCount} 张</div>
                        <div className="relative">
                            <button 
                                onClick={() => setShowCleanMenu(!showCleanMenu)} 
                                className="px-3 py-1 md:px-4 md:py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-xs md:text-sm hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center gap-1"
                            >
                                清理
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            {showCleanMenu && (
                                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                                    <button 
                                        onClick={handleClearAll} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                                    >
                                        🗑️ 清空全部
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('days')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        ⏰ 删除 X 天前的...
                                    </button>
                                    <button 
                                        onClick={() => handleCleanMenuClick('count')} 
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 rounded-b-lg"
                                    >
                                        📊 只保留最近 N 张...
                                    </button>
                                </div>
                            )}
                        </div>
                        <button onClick={() => goToPage(currentPage)} className="px-3 py-1 md:px-4 md:py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs md:text-sm hover:bg-gray-200 dark:hover:bg-gray-600">
                            刷新
                        </button>
                    </div>
                </div>

                {/* 分页控件 */}
                {totalCount > 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        {/* 页码信息 */}
                        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                            <span>第 {currentPage} 页 / 共 {totalPages} 页</span>
                            <span className="text-gray-400 dark:text-gray-500">|</span>
                            <span>显示 {Math.min((currentPage - 1) * PAGE_SIZE + 1, totalCount)} - {Math.min(currentPage * PAGE_SIZE, totalCount)} 张</span>
                        </div>

                        {/* 分页按钮 */}
                        <div className="flex items-center gap-2">
                            {/* 首页 */}
                            <button
                                onClick={() => goToPage(1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                首页
                            </button>

                            {/* 上一页 */}
                            <button
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage === 1 || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                上一页
                            </button>

                            {/* 页码按钮 */}
                            <div className="flex gap-1">
                                {getPageButtons().map(page => (
                                    <button
                                        key={page}
                                        onClick={() => goToPage(page)}
                                        onMouseEnter={() => loadPage(page)}
                                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                                            page === currentPage
                                                ? 'bg-indigo-500 text-white border-indigo-500'
                                                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        {page}
                                    </button>
                                ))}
                            </div>

                            {/* 下一页 */}
                            <button
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                下一页
                            </button>

                            {/* 末页 */}
                            <button
                                onClick={() => goToPage(totalPages)}
                                disabled={currentPage === totalPages || isLoading}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                末页
                            </button>
                        </div>

                        {/* 页码输入框 */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 dark:text-gray-300">跳至</span>
                            <input
                                type="number"
                                min="1"
                                max={totalPages}
                                placeholder="页码"
                                className="w-16 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const page = parseInt((e.target as HTMLInputElement).value);
                                        if (page >= 1 && page <= totalPages) {
                                            goToPage(page);
                                        }
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    const input = document.querySelector('input[placeholder="页码"]') as HTMLInputElement;
                                    const page = parseInt(input.value);
                                    if (page >= 1 && page <= totalPages) {
                                        goToPage(page);
                                    }
                                }}
                                className="px-2 py-1 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors"
                            >
                                跳转
                            </button>
                        </div>
                    </div>
                )}
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20">
                {items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="text-4xl mb-2">🕰️</div>
                        <p>暂无生成记录</p>
                        <p className="text-sm mt-2">在 Chain 编辑器中生成图片会自动保存到这里</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    className="group relative aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
                                    onClick={() => setLightbox(item)}
                                >
                                    <img src={item.imageUrl} className="w-full h-full object-cover" loading="lazy" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                    <div className="absolute top-2 right-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => handleDelete(item.id, e)} className="p-1.5 bg-red-500 text-white rounded-full shadow hover:bg-red-600">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity truncate">
                                        {new Date(item.createdAt).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        {/* 底部分页信息 */}
                        <div className="flex flex-col items-center justify-center py-6">
                            {isLoading ? (
                                <div className="text-gray-500 dark:text-gray-400">⏳ 加载中...</div>
                            ) : (
                                <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                    <p>当前显示第 {Math.min((currentPage - 1) * PAGE_SIZE + 1, totalCount)} - {Math.min(currentPage * PAGE_SIZE, totalCount)} 张</p>
                                    <p className="mt-1">共 {totalCount} 张，已缓存 {Object.keys(pageCache).length} 页</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Lightbox */}
            {lightbox && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8" onClick={() => setLightbox(null)}>
                    <div className="bg-white dark:bg-gray-900 w-full max-w-6xl h-[85vh] md:h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                        {/* Image Area */}
                        <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative h-[45%] md:h-auto border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800">
                            <img src={lightbox.imageUrl} className="max-w-full max-h-full object-contain shadow-lg" />
                        </div>

                        {/* Details Area */}
                        <div className="w-full md:w-[400px] bg-white dark:bg-gray-900 flex flex-col p-4 md:p-6 h-[55%] md:h-auto overflow-hidden">
                            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">图片详情</h2>
                                <button onClick={() => setLightbox(null)} className="text-gray-500 hover:text-gray-900 dark:hover:text-white p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                                {/* Prompt Section */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                            Prompt
                                        </label>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(lightbox.prompt); notify('Prompt 已复制'); }}
                                            className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                                        >
                                            复制
                                        </button>
                                    </div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300 font-mono break-words bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 p-3 rounded-lg leading-relaxed select-text">
                                        {lightbox.prompt}
                                    </div>
                                </div>

                                {/* Parameters Grid */}
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                        Parameters
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <ParamItem label="Resolution" value={`${lightbox.params.width} × ${lightbox.params.height}`} />
                                        <ParamItem label="Steps" value={lightbox.params.steps} />
                                        <ParamItem label="Scale" value={lightbox.params.scale} />
                                        <ParamItem label="Sampler" value={lightbox.params.sampler.replace(/_/g, ' ')} />
                                        <ParamItem label="Seed" value={lightbox.params.seed ?? 'Random'} />
                                        <ParamItem label="Quality Tags" value={lightbox.params.qualityToggle ? 'On' : 'Off'} />
                                        <ParamItem label="UC Preset" value={lightbox.params.ucPreset !== undefined ? UC_LABELS[lightbox.params.ucPreset] ?? lightbox.params.ucPreset : '-'} />
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-4 space-y-3 flex-shrink-0">
                                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                                    <label className="block text-xs font-bold text-indigo-600 dark:text-indigo-400 mb-2">发布到灵感图库</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="为这张图取个标题..."
                                            className="flex-1 px-3 py-2 rounded border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 text-sm outline-none dark:text-white focus:border-indigo-500 transition-colors"
                                            value={publishTitle}
                                            onChange={e => setPublishTitle(e.target.value)}
                                        />
                                        <button
                                            onClick={handlePublish}
                                            disabled={isPublishing}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-bold whitespace-nowrap disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            {isPublishing ? '发布中' : '发布'}
                                        </button>
                                    </div>
                                </div>
                                <a
                                    href={lightbox.imageUrl}
                                    download={getDownloadFilename()}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-bold transition-colors shadow-lg"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                    下载原图
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Clean Modal */}
            {showCleanModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">⚠️ 确认清理</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            {cleanMode === 'days' 
                                ? `将删除 ${cleanDays} 天前的 ${cleanPreviewCount} 张图片`
                                : `当前共 ${totalCount} 张，将删除 ${cleanPreviewCount} 张，只保留最近 ${cleanCount} 张`
                            }
                        </p>
                        <p className="text-xs text-red-500 mb-4">此操作无法恢复</p>
                        
                        <div className="mb-4">
                            {cleanMode === 'days' ? (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">天数</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanDays}
                                        onChange={e => {
                                            setCleanDays(Number(e.target.value));
                                            localHistory.countOlderThan(Number(e.target.value)).then(setCleanPreviewCount);
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">保留数量</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={cleanCount}
                                        onChange={e => {
                                            setCleanCount(Number(e.target.value));
                                            localHistory.getCount().then(count => {
                                                setCleanPreviewCount(Math.max(0, count - Number(e.target.value)));
                                            });
                                        }}
                                        className="w-full px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                                    />
                                </div>
                            )}
                        </div>
                        
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowCleanModal(false)}
                                className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg font-bold"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCleanConfirm}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {showSuccessModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center animate-bounce-in">
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center text-3xl mb-4">
                            ✨
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">发布成功！</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            您的作品已添加到灵感图库，其他用户可以查看并引用您的 Prompt。
                        </p>
                        <button
                            onClick={() => setShowSuccessModal(false)}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg transition-all"
                        >
                            好哒喵~
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
