import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { assertWorkspace } from './validation';
import { type Workspace } from './model';

const KEY = 'progress.workspace.v1';
export async function loadWorkspace(): Promise<{ workspace?: Workspace; error?: string }> {
  try {
    const raw = Capacitor.isNativePlatform() ? (await Preferences.get({ key: KEY })).value : localStorage.getItem(KEY);
    if (!raw) return {};
    const value = JSON.parse(raw); assertWorkspace(value);
    return { workspace: value };
  } catch { return { error: '无法读取已保存的工作区。原数据仍保留；当前使用临时空工作区，请先导出备份或重新导入。' }; }
}
let queue = Promise.resolve();
export function saveWorkspace(workspace: Workspace): Promise<void> {
  const raw = JSON.stringify(workspace);
  const write = async () => {
    if (Capacitor.isNativePlatform()) await Preferences.set({ key: KEY, value: raw });
    else localStorage.setItem(KEY, raw);
  };
  queue = queue.catch(() => {}).then(write);
  return queue;
}
export async function download(name: string, data: string | Uint8Array, type = 'application/octet-stream'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    let value: string;
    if (typeof data === 'string') value = data;
    else {
      value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = reject;
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(new Blob([new Uint8Array(data).buffer]));
      });
    }
    const result = await Filesystem.writeFile({ path: name, data: value, directory: Directory.Cache,
      ...(typeof data === 'string' ? { encoding: Encoding.UTF8 } : {}) });
    await Share.share({ title: '导出 Progress', files: [result.uri] });
    return;
  }
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data).buffer], { type });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
