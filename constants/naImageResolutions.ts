/** 军火库「实装」生成图分辨率选项 */
export const BENCHMARK_RESOLUTION_OPTIONS: ReadonlyArray<{ width: number; height: number; label: string }> = [
  { width: 832, height: 1216, label: '832×1216 竖屏' },
  { width: 1216, height: 832, label: '1216×832 横屏' },
  { width: 512, height: 768, label: '512×768 竖屏' },
  { width: 768, height: 512, label: '768×512 横屏' },
];

/** 链编辑器 / 批量测试「图片尺寸」下拉 */
export const CHAIN_RESOLUTION_PRESETS: Record<string, { width: number; height: number; label: string }> = {
  Portrait: { width: 832, height: 1216, label: '竖屏 (832×1216)' },
  Landscape: { width: 1216, height: 832, label: '横屏 (1216×832)' },
  PortraitSm: { width: 512, height: 768, label: '竖屏 (512×768)' },
  LandscapeSm: { width: 768, height: 512, label: '横屏 (768×512)' },
  Square: { width: 1024, height: 1024, label: '方形 (1024×1024)' },
};

export function resolutionSelectValue(width: number, height: number): string {
  return `${width}x${height}`;
}
