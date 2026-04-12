import React, { useState, useRef, useMemo, useEffect } from 'react';
import { ChainEditorParams } from './ChainEditorParams';
import { generateImage } from '../services/naiService';
import { localHistory } from '../services/localHistory';
import { db } from '../services/dbService';
import {
  MAX_ARTISTS,
  parseArtistInput,
  mergeArtistSources,
  buildJobs,
  resolveSeedForApiCall,
  type ArtistBatchJob,
} from '../services/artistBatch';
import type { Artist, NAIParams, User } from '../types';

const DEFAULT_PARAMS: NAIParams = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
};

const MODES = ['Equal', 'Fixed Some', 'Full Random', 'Iterate', 'Single'] as const;

const BATCH_PREFS_KEY = 'nai_batch_tester_prefs_v1';

type BatchTesterPersisted = {
  artistText: string;
  selectedArtists: string[];
  basePositive: string;
  negativePrompt: string;
  nonArtistBlock: string;
  mode: string;
  fixedStrengthsText: string;
  randMin: number;
  randMax: number;
  iterMin: number;
  iterMax: number;
  iterStep: number;
  iterBase: number;
  batchCount: number;
  imagesPerArtist: number;
  singleStrength: number;
  cooldownMinSec: number;
  cooldownMaxSec: number;
  dedupeGuard: boolean;
  batchParams: NAIParams;
};

function readBatchPrefs(): Partial<BatchTesterPersisted> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BATCH_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BatchTesterPersisted>;
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

function writeBatchPrefs(p: BatchTesterPersisted): void {
  try {
    localStorage.setItem(BATCH_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepInterruptible(
  ms: number,
  stopRef: React.MutableRefObject<boolean>
): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopRef.current) return true;
    await sleep(250);
  }
  return false;
}

interface ArtistBatchTesterProps {
  currentUser: User;
  artistsData: Artist[] | null;
  onRefreshArtists: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ArtistBatchTester: React.FC<ArtistBatchTesterProps> = ({
  currentUser,
  artistsData,
  onRefreshArtists,
  notify,
}) => {
  const [artistText, setArtistText] = useState('');
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [basePositive, setBasePositive] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [nonArtistBlock, setNonArtistBlock] = useState('');
  const [mode, setMode] = useState<string>('Equal');
  const [fixedStrengthsText, setFixedStrengthsText] = useState('');
  const [randMin, setRandMin] = useState(0.4);
  const [randMax, setRandMax] = useState(1.2);
  const [iterMin, setIterMin] = useState(1);
  const [iterMax, setIterMax] = useState(2);
  const [iterStep, setIterStep] = useState(0.2);
  const [iterBase, setIterBase] = useState(1);
  const [batchCount, setBatchCount] = useState(20);
  const [imagesPerArtist, setImagesPerArtist] = useState(2);
  const [singleStrength, setSingleStrength] = useState(1);
  const [cooldownMinSec, setCooldownMinSec] = useState(2);
  const [cooldownMaxSec, setCooldownMaxSec] = useState(15);
  const [dedupeGuard, setDedupeGuard] = useState(false);
  const [batchParams, setBatchParams] = useState<NAIParams>({ ...DEFAULT_PARAMS });
  const [apiKey, setApiKey] = useState('');
  const [jobs, setJobs] = useState<ArtistBatchJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const stopRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryPick, setLibraryPick] = useState<Set<string>>(new Set());
  const [publishTarget, setPublishTarget] = useState<{
    imageUrl: string;
    prompt: string;
  } | null>(null);
  const [publishTitle, setPublishTitle] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [lightbox, setLightbox] = useState<{
    imageUrl: string;
    prompt: string;
  } | null>(null);

  const pool = useMemo(() => parseArtistInput(artistText), [artistText]);

  useEffect(() => {
    const saved = localStorage.getItem('nai_api_key');
    if (saved) setApiKey(saved);
  }, []);

  /** 从 localStorage 恢复批量页设置（不含 API Key、不含队列） */
  useEffect(() => {
    const p = readBatchPrefs();
    if (p) {
      if (typeof p.artistText === 'string') setArtistText(p.artistText);
      if (typeof p.basePositive === 'string') setBasePositive(p.basePositive);
      if (typeof p.negativePrompt === 'string') setNegativePrompt(p.negativePrompt);
      if (typeof p.nonArtistBlock === 'string') setNonArtistBlock(p.nonArtistBlock);
      if (typeof p.mode === 'string') setMode(p.mode);
      if (typeof p.fixedStrengthsText === 'string')
        setFixedStrengthsText(p.fixedStrengthsText);
      if (typeof p.randMin === 'number') setRandMin(p.randMin);
      if (typeof p.randMax === 'number') setRandMax(p.randMax);
      if (typeof p.iterMin === 'number') setIterMin(p.iterMin);
      if (typeof p.iterMax === 'number') setIterMax(p.iterMax);
      if (typeof p.iterStep === 'number') setIterStep(p.iterStep);
      if (typeof p.iterBase === 'number') setIterBase(p.iterBase);
      if (typeof p.batchCount === 'number') setBatchCount(p.batchCount);
      if (typeof p.imagesPerArtist === 'number')
        setImagesPerArtist(p.imagesPerArtist);
      if (typeof p.singleStrength === 'number')
        setSingleStrength(p.singleStrength);
      if (typeof p.cooldownMinSec === 'number')
        setCooldownMinSec(p.cooldownMinSec);
      if (typeof p.cooldownMaxSec === 'number')
        setCooldownMaxSec(p.cooldownMaxSec);
      if (typeof p.dedupeGuard === 'boolean') setDedupeGuard(p.dedupeGuard);
      if (p.batchParams && typeof p.batchParams === 'object') {
        setBatchParams({ ...DEFAULT_PARAMS, ...p.batchParams });
      }
      if (Array.isArray(p.selectedArtists)) {
        const text = typeof p.artistText === 'string' ? p.artistText : '';
        const pl = parseArtistInput(text);
        setSelectedArtists(
          p.selectedArtists.filter((n) => pl.some((x) => x === n))
        );
      }
    }
    setPrefsHydrated(true);
  }, []);

  useEffect(() => {
    setSelectedArtists((prev) =>
      prev.filter((n) => pool.some((p) => p === n))
    );
  }, [pool]);

  /** 自动保存当前设置（防抖） */
  useEffect(() => {
    if (!prefsHydrated) return;
    const t = window.setTimeout(() => {
      writeBatchPrefs({
        artistText,
        selectedArtists,
        basePositive,
        negativePrompt,
        nonArtistBlock,
        mode,
        fixedStrengthsText,
        randMin,
        randMax,
        iterMin,
        iterMax,
        iterStep,
        iterBase,
        batchCount,
        imagesPerArtist,
        singleStrength,
        cooldownMinSec,
        cooldownMaxSec,
        dedupeGuard,
        batchParams,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    prefsHydrated,
    artistText,
    selectedArtists,
    basePositive,
    negativePrompt,
    nonArtistBlock,
    mode,
    fixedStrengthsText,
    randMin,
    randMax,
    iterMin,
    iterMax,
    iterStep,
    iterBase,
    batchCount,
    imagesPerArtist,
    singleStrength,
    cooldownMinSec,
    cooldownMaxSec,
    dedupeGuard,
    batchParams,
  ]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleApiKeyChange = (v: string) => {
    setApiKey(v);
    localStorage.setItem('nai_api_key', v);
  };

  const togglePoolArtist = (name: string) => {
    setSelectedArtists((prev) => {
      const i = prev.indexOf(name);
      if (i >= 0) return prev.filter((_, j) => j !== i);
      if (prev.length >= MAX_ARTISTS) {
        notify(`最多选择 ${MAX_ARTISTS} 名画师`, 'error');
        return prev;
      }
      return [...prev, name];
    });
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = await f.text();
    const { mergedText, artists } = mergeArtistSources(artistText, text, f.name);
    setArtistText(mergedText);
    notify(`已从文件合并 ${artists.length} 名画师`);
  };

  const addFromLibrary = () => {
    if (!libraryPick.size) {
      setShowLibraryModal(false);
      return;
    }
    const extra = [...libraryPick].map((n) => `artist:${n}`).join(', ');
    const { mergedText } = mergeArtistSources(
      artistText ? `${artistText}, ${extra}` : extra,
      null
    );
    setArtistText(mergedText);
    setLibraryPick(new Set());
    setShowLibraryModal(false);
    notify('已从军火库合并画师');
  };

  const runBatch = async () => {
    if (!apiKey.trim()) {
      notify('请先填写 API Key', 'error');
      return;
    }
    const chosen = selectedArtists.slice(0, MAX_ARTISTS);
    if (!chosen.length) {
      notify('请至少选择一名画师', 'error');
      return;
    }

    const built = buildJobs({
      selectedArtists: chosen,
      positivePrompt: basePositive,
      mode,
      fixedStrengthsText,
      randMin,
      randMax,
      iterMin,
      iterMax,
      iterStep,
      iterBase,
      nonArtistBlock,
      batchCount,
      imagesPerArtist,
      singleStrength,
    });

    const runList: ArtistBatchJob[] = built.map((j) => ({
      ...j,
      state: 'Pending' as const,
      attempts: 0,
      error: '',
    }));

    setJobs(runList);
    stopRef.current = false;
    setIsRunning(true);

    const known = new Set<string>();
    const seedResolved = resolveSeedForApiCall(batchParams);
    const paramsForCall: NAIParams = {
      ...batchParams,
      seed: seedResolved !== undefined ? seedResolved : undefined,
    };

    for (let i = 0; i < runList.length; i++) {
      const job = runList[i]!;
      if (stopRef.current) {
        job.state = 'Skipped';
        job.error = '用户停止';
        setJobs([...runList]);
        break;
      }
      if (dedupeGuard && known.has(job.signature)) {
        job.state = 'Skipped';
        job.error = '重复 signature';
        setJobs([...runList]);
        continue;
      }

      job.state = 'Running';
      setJobs([...runList]);

      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        if (stopRef.current) break;
        try {
          const { image } = await generateImage(
            apiKey,
            job.fullPrompt,
            negativePrompt,
            paramsForCall
          );
          job.state = 'Success';
          job.imageUrl = image;
          job.attempts = attempt + 1;
          job.error = '';
          await localHistory.add(image, job.fullPrompt, paramsForCall);
          if (dedupeGuard) known.add(job.signature);
          ok = true;
        } catch (err: unknown) {
          job.attempts = attempt + 1;
          job.error = err instanceof Error ? err.message : String(err);
          if (attempt === 0 && !stopRef.current) {
            job.state = 'Retrying';
            setJobs([...runList]);
            const aborted = await sleepInterruptible(3000, stopRef);
            if (aborted) break;
          } else {
            job.state = 'Failed';
          }
        }
        setJobs([...runList]);
      }

      if (!ok && job.state === 'Retrying') {
        job.state = 'Failed';
        setJobs([...runList]);
      }

      if (i < runList.length - 1 && !stopRef.current) {
        const lo = Math.min(cooldownMinSec, cooldownMaxSec);
        const hi = Math.max(cooldownMinSec, cooldownMaxSec);
        const cdMs = (lo + Math.random() * (hi - lo)) * 1000;
        const aborted = await sleepInterruptible(cdMs, stopRef);
        if (aborted) break;
      }
    }

    setIsRunning(false);
    notify('批量任务已结束', 'success');
  };

  const handlePublish = async () => {
    if (!publishTarget) return;
    if (!publishTitle.trim()) {
      notify('请输入标题', 'error');
      return;
    }
    setIsPublishing(true);
    try {
      await db.saveInspiration({
        id: crypto.randomUUID(),
        title: publishTitle.trim(),
        imageUrl: publishTarget.imageUrl,
        prompt: publishTarget.prompt,
        userId: currentUser.id,
        username: currentUser.username,
        createdAt: Date.now(),
      });
      notify('发布成功！已加入灵感图库');
      setPublishTitle('');
      setPublishTarget(null);
    } catch (e: unknown) {
      notify('发布失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900">
      <header className="p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">批量测试</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          多画师强度策略串行生图，结果写入本地历史并可发布灵感；表单与参数会自动记住（仅本机）
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24 md:pb-8">
        <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <label className="text-xs font-semibold text-gray-500 uppercase">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="NovelAI API Key（存本地）"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </section>

        <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">画师池</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLibraryModal(true)}
                className="px-3 py-1.5 text-xs rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
              >
                从军火库导入
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                上传 txt/csv
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,text/plain"
                className="hidden"
                onChange={onFileChange}
              />
              <button
                type="button"
                onClick={onRefreshArtists}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                刷新军火库数据
              </button>
            </div>
          </div>
          <textarea
            value={artistText}
            onChange={(e) => setArtistText(e.target.value)}
            rows={4}
            placeholder="artist:name1, artist:name2 或带权重片段…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
          />
          <div>
            <p className="text-xs text-gray-500 mb-2">
              从池中勾选参与批跑的画师（最多 {MAX_ARTISTS}）
            </p>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {pool.map((name) => (
                <label
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedArtists.includes(name)}
                    onChange={() => togglePoolArtist(name)}
                  />
                  {name}
                </label>
              ))}
              {!pool.length && (
                <span className="text-xs text-gray-400">池为空，请先输入或导入</span>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">Prompt</h2>
          <textarea
            value={basePositive}
            onChange={(e) => setBasePositive(e.target.value)}
            rows={3}
            placeholder="基底正向 prompt（与画师前缀拼接）"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            rows={2}
            placeholder="负面 prompt"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <textarea
            value={nonArtistBlock}
            onChange={(e) => setNonArtistBlock(e.target.value)}
            rows={2}
            placeholder="可选附加段（非画师块，拼进前缀）"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </section>

        <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">强度策略</h2>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs ${
                  mode === m
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            value={fixedStrengthsText}
            onChange={(e) => setFixedStrengthsText(e.target.value)}
            placeholder="Fixed Some：artist:a=0.8, artist:b=0.6"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <label className="flex flex-col gap-1">
              随机 min
              <input
                type="number"
                step={0.05}
                value={randMin}
                onChange={(e) => setRandMin(parseFloat(e.target.value) || 0)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              随机 max
              <input
                type="number"
                step={0.05}
                value={randMax}
                onChange={(e) => setRandMax(parseFloat(e.target.value) || 0)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Iterate min
              <input
                type="number"
                step={0.1}
                value={iterMin}
                onChange={(e) => setIterMin(parseFloat(e.target.value) || 0)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Iterate max
              <input
                type="number"
                step={0.1}
                value={iterMax}
                onChange={(e) => setIterMax(parseFloat(e.target.value) || 0)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Iterate step
              <input
                type="number"
                step={0.1}
                value={iterStep}
                onChange={(e) => setIterStep(parseFloat(e.target.value) || 0.2)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Iterate baseline
              <input
                type="number"
                step={0.1}
                value={iterBase}
                onChange={(e) => setIterBase(parseFloat(e.target.value) || 1)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              批量次数
              <input
                type="number"
                min={1}
                max={500}
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value, 10) || 1)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Single 每画师张数
              <input
                type="number"
                min={1}
                max={20}
                value={imagesPerArtist}
                onChange={(e) => setImagesPerArtist(parseInt(e.target.value, 10) || 1)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1">
              Single 固定强度
              <input
                type="number"
                step={0.05}
                value={singleStrength}
                onChange={(e) => setSingleStrength(parseFloat(e.target.value) || 1)}
                className="px-2 py-1 rounded border dark:bg-gray-900 dark:border-gray-700"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 items-center text-xs">
            <label className="flex items-center gap-2">
              冷却 min (s)
              <input
                type="number"
                step={0.5}
                value={cooldownMinSec}
                onChange={(e) => setCooldownMinSec(parseFloat(e.target.value) || 0)}
                className="w-20 px-2 py-1 rounded border dark:bg-gray-900"
              />
            </label>
            <label className="flex items-center gap-2">
              冷却 max (s)
              <input
                type="number"
                step={0.5}
                value={cooldownMaxSec}
                onChange={(e) => setCooldownMaxSec(parseFloat(e.target.value) || 0)}
                className="w-20 px-2 py-1 rounded border dark:bg-gray-900"
              />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={dedupeGuard}
                onChange={(e) => setDedupeGuard(e.target.checked)}
              />
              本次运行内按 signature 去重
            </label>
          </div>
        </section>

        <ChainEditorParams
          params={batchParams}
          setParams={setBatchParams}
          canEdit={true}
          markChange={() => {}}
        />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={isRunning}
            onClick={runBatch}
            className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold disabled:opacity-50"
          >
            {isRunning ? '运行中…' : '开始批量'}
          </button>
          <button
            type="button"
            disabled={!isRunning}
            onClick={() => {
              stopRef.current = true;
            }}
            className="px-6 py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
          >
            停止
          </button>
        </div>

        {jobs.length > 0 && (
          <section className="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-4 overflow-x-auto">
            <h2 className="text-sm font-bold mb-3 text-gray-800 dark:text-gray-200">
              队列 ({jobs.length})
            </h2>
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="p-2">#</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">尝试</th>
                  <th className="p-2">错误</th>
                  <th className="p-2">预览</th>
                  <th className="p-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.index} className="border-b border-gray-100 dark:border-gray-800/80">
                    <td className="p-2 align-top">{j.index}</td>
                    <td className="p-2 align-top">{j.state}</td>
                    <td className="p-2 align-top">{j.attempts}</td>
                    <td className="p-2 align-top text-red-600 dark:text-red-400 max-w-[200px] break-words">
                      {j.error}
                    </td>
                    <td className="p-2 align-top">
                      {j.imageUrl ? (
                        <button
                          type="button"
                          title="点击查看大图"
                          onClick={() =>
                            setLightbox({
                              imageUrl: j.imageUrl!,
                              prompt: j.fullPrompt,
                            })
                          }
                          className="block rounded overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <img
                            src={j.imageUrl}
                            alt="预览"
                            className="w-16 h-16 object-cover hover:opacity-90 transition-opacity"
                          />
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-2 align-top">
                      {j.state === 'Success' && j.imageUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setPublishTarget({
                              imageUrl: j.imageUrl!,
                              prompt: j.fullPrompt,
                            });
                            setPublishTitle('');
                          }}
                          className="text-indigo-600 dark:text-indigo-400 underline"
                        >
                          发布灵感
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {showLibraryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <span className="font-bold text-gray-900 dark:text-white">军火库画师</span>
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                className="text-gray-500"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {(artistsData ?? []).map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={libraryPick.has(a.name)}
                    onChange={() => {
                      setLibraryPick((prev) => {
                        const n = new Set(prev);
                        if (n.has(a.name)) n.delete(a.name);
                        else n.add(a.name);
                        return n;
                      });
                    }}
                  />
                  {a.name}
                </label>
              ))}
              {!artistsData?.length && (
                <p className="text-xs text-gray-500">暂无数据，请先刷新军火库</p>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLibraryModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addFromLibrary}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm"
              >
                合并到池
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="大图预览"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white/90 hover:text-white text-2xl leading-none px-2"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
          >
            ✕
          </button>
          <div
            className="max-w-full max-h-[85vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.imageUrl}
              alt="生成图"
              className="max-w-full max-h-[75vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
            />
            <p className="text-xs text-white/80 max-w-2xl max-h-24 overflow-y-auto text-center px-2">
              {lightbox.prompt}
            </p>
          </div>
        </div>
      )}

      {publishTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3">发布到灵感</h3>
            <input
              value={publishTitle}
              onChange={(e) => setPublishTitle(e.target.value)}
              placeholder="标题"
              className="w-full px-3 py-2 rounded-lg border dark:bg-gray-950 dark:border-gray-700 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPublishTarget(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPublishing}
                onClick={handlePublish}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
              >
                {isPublishing ? '发布中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
