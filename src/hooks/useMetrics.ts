import { useEffect, useRef, useState } from "react";
import { refreshInterval, type Workspace } from "../core/model";
import {
  DataSourceError,
  fetchMetrics,
  localMetrics,
  runtimeError,
} from "../core/runtime";
import {
  CodexError,
  cachedCodexUsage,
  cacheCodexUsage,
  clearCodexCache,
  readCodexUsage,
  watchCodex,
  type CodexUsage,
} from "../core/codex";
import { ownerRequest } from "../core/pairing";
import {
  readInstanceConnections,
  newestSnapshot,
  sourceSignature,
  sampleCacheKey,
} from "../core/providers";
import { vaultGet, vaultUpdate, vaultDelete } from "../core/vault";
import { type Snapshot } from "../core/sourceState";
export type { Snapshot } from "../core/sourceState";

export function useMetrics(workspace: Workspace) {
  const [remote, setRemote] = useState<Record<string, Snapshot>>({});
  const signatures = useRef<Record<string, string>>({});
  const retry = useRef<(id?: string, manual?: boolean) => void>(() => {});
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const sources = workspace.instances.filter(
    (instance) =>
      workspace.components.find(
        (c) => c.manifest.id === instance.componentId,
      ) &&
      ["http", "codex_usage", "provider_quota"].includes(
        workspace.components.find(
          (c) => c.manifest.id === instance.componentId,
        )!.manifest.runtime.type,
      ),
  );
  const sourceKey = JSON.stringify({
    sources: sources.map((instance) => ({
      instance,
      component: workspace.components.find(
        (c) => c.manifest.id === instance.componentId,
      ),
    })),
    connections: workspace.connections,
  });
  const tick =
    sources.some(
      (i) =>
        workspace.components.find((c) => c.manifest.id === i.componentId)
          ?.manifest.runtime.type === "http",
    ) || workspace.components.some((c) => c.metrics?.some((m) => m.observed_at))
      ? 1000
      : sources.length ||
          workspace.instances.some(
            (i) =>
              workspace.components.find((c) => c.manifest.id === i.componentId)
                ?.manifest.runtime.type === "time_range",
          )
        ? 30000
        : 0;
  useEffect(() => {
    setNow(Date.now());
    if (!tick) return;
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, tick);
    return () => clearInterval(timer);
  }, [tick]);
  useEffect(() => {
    let stopped = false;
    const controllers = new Map<string, AbortController>();
    const deadlines = new Map<string, number>();
    const failures = new Map<string, number>();
    const queued = new Set<string>();
    const manualRequests = new Set<string>();
    const nextSignatures = Object.fromEntries(
      sources.map((i) => [i.id, sourceSignature(workspace, i)]),
    );
    const previousSignatures = signatures.current;
    signatures.current = nextSignatures;
    setRemote((previous) =>
      Object.fromEntries(
        sources.map((i) => {
          const quota =
            workspace.components.find((c) => c.manifest.id === i.componentId)
              ?.manifest.runtime.type === "codex_usage" &&
            !i.connectionIds?.length
              ? cachedCodexUsage(String(i.config.accountKey ?? ""))
              : undefined;
          return [
            i.id,
            previousSignatures[i.id] === nextSignatures[i.id]
              ? (previous[i.id] ?? { metrics: [] })
              : quota
                ? {
                    metrics: quota.metrics,
                    quota,
                    lastSuccess: Date.parse(quota.observedAt),
                  }
                : { metrics: [] },
          ];
        }),
      ),
    );
    for (const instance of sources)
      if (instance.connectionIds)
        void vaultGet<Snapshot>(sampleCacheKey(workspace, instance))
          .then((snapshot) => {
            if (!stopped && snapshot)
              setRemote((previous) => {
                const current = previous[instance.id];
                if (current?.errorCode === "account-mismatch") return previous;
                const restored = newestSnapshot(
                  snapshot,
                  current?.observedAt ? current : snapshot,
                );
                return {
                  ...previous,
                  [instance.id]: {
                    ...restored,
                    loading: current?.loading,
                    error: current?.error,
                    errorCode: current?.errorCode,
                  },
                };
              });
          })
          .catch(() => {});
    function update(id?: string) {
      if (document.hidden || stopped) return;
      for (const instance of sources) {
        const component = workspace.components.find(
          (c) => c.manifest.id === instance.componentId,
        )!;
        const codex = ["codex_usage", "provider_quota"].includes(
          component.manifest.runtime.type,
        );
        if (
          (id && instance.id !== id) ||
          (!codex && (!instance.networkConsent || !navigator.onLine)) ||
          controllers.has(instance.id) ||
          (deadlines.get(instance.id) ?? 0) > Date.now()
        )
          continue;
        const controller = new AbortController();
        controllers.set(instance.id, controller);
        const timeout = setTimeout(
          () => controller.abort(new DOMException("Timeout", "TimeoutError")),
          codex ? 15000 : 10000,
        );
        setRemote((previous) => ({
          ...previous,
          [instance.id]: {
            ...previous[instance.id],
            metrics: previous[instance.id]?.metrics ?? [],
            loading: true,
            manualLoading: manualRequests.has(instance.id),
          },
        }));
        const request: Promise<Snapshot> =
          codex && instance.connectionIds
            ? readInstanceConnections(workspace, instance, controller.signal)
            : codex
              ? readCodexUsage(
                  String(instance.config.accountKey ?? ""),
                  controller.signal,
                ).then((quota) => {
                  if (!stopped) cacheCodexUsage(quota);
                  return {
                    metrics: quota.metrics,
                    quota,
                    lastSuccess: Date.parse(quota.observedAt),
                  };
                })
              : fetchMetrics(component, instance, controller.signal).then(
                  (metrics) => ({ metrics, lastSuccess: Date.now() }),
                );
        void request
          .then((snapshot) => {
            if (!stopped) {
              failures.set(instance.id, 0);
              setRemote((previous) => ({
                ...previous,
                [instance.id]: newestSnapshot(previous[instance.id], snapshot),
              }));
              if (snapshot.quota && snapshot.connectionId)
                void ownerRequest("publish", {
                  connectionId: snapshot.connectionId,
                  snapshot: { data: snapshot.metrics },
                }).catch(() => {});
              if (snapshot.observedAt)
                void vaultUpdate<Snapshot>(
                  sampleCacheKey(workspace, instance),
                  (previous) => newestSnapshot(previous, snapshot),
                ).catch(() => {});
            }
          })
          .catch((error) => {
            if (!stopped) {
              failures.set(instance.id, (failures.get(instance.id) ?? 0) + 1);
              const errorCode =
                error instanceof CodexError || error instanceof DataSourceError
                  ? error.code
                  : controller.signal.reason?.name === "TimeoutError"
                    ? "timeout"
                    : "connection";
              if (errorCode === "account-mismatch") {
                clearCodexCache(String(instance.config.accountKey ?? ""));
                void vaultDelete(sampleCacheKey(workspace, instance)).catch(
                  () => {},
                );
              }
              setRemote((previous) => ({
                ...previous,
                [instance.id]: {
                  ...(errorCode === "account-mismatch"
                    ? { metrics: [] }
                    : previous[instance.id]),
                  metrics:
                    errorCode === "account-mismatch"
                      ? []
                      : (previous[instance.id]?.metrics ?? []),
                  loading: false,
                  manualLoading: false,
                  error: runtimeError(controller.signal.reason ?? error),
                  errorCode,
                },
              }));
            }
          })
          .finally(() => {
            clearTimeout(timeout);
            controllers.delete(instance.id);
            if (!stopped && queued.delete(instance.id)) {
              deadlines.delete(instance.id);
              queueMicrotask(() => update(instance.id));
              return;
            }
            manualRequests.delete(instance.id);
            const interval = refreshInterval(component, instance);
            deadlines.set(
              instance.id,
              Date.now() +
                Math.min(
                  86400,
                  interval *
                    Math.min(20, 2 ** (failures.get(instance.id) ?? 0)),
                ) *
                  1000,
            );
          });
      }
    }
    const refresh = (id?: string, manual = false) => {
      if (manual && !document.hidden) for (const instance of sources) {
        const quota = ['codex_usage', 'provider_quota'].includes(workspace.components.find(c => c.manifest.id === instance.componentId)!.manifest.runtime.type);
        if ((!id || instance.id === id) && (quota || instance.networkConsent && navigator.onLine)) manualRequests.add(instance.id);
      }
      if (id) {
        deadlines.delete(id);
        failures.delete(id);
      } else {
        deadlines.clear();
        failures.clear();
      }
      for (const active of controllers.keys())
        if (!id || id === active) queued.add(active);
      setNow(Date.now());
      update(id);
    };
    retry.current = refresh;
    void update();
    const stopWatching = sources.some(
      (i) =>
        workspace.components.find((c) => c.manifest.id === i.componentId)
          ?.manifest.runtime.type === "codex_usage",
    )
      ? watchCodex(() => {
          for (const instance of sources)
            if (
              workspace.components.find(
                (c) => c.manifest.id === instance.componentId,
              )?.manifest.runtime.type === "codex_usage"
            )
              refresh(instance.id);
        })
      : () => {};
    const timer = sources.length
      ? setInterval(
          () => update(),
          sources.some(
            (i) =>
              workspace.components.find((c) => c.manifest.id === i.componentId)
                ?.manifest.runtime.type === "http",
          )
            ? 1000
            : 30000,
        )
      : undefined;
    const visible = () => {
      if (!document.hidden) {
        setNow(Date.now());
        refresh();
      }
    };
    const reconnected = () => {
      setOnline(true);
      refresh();
    };
    const disconnected = () => {
      setOnline(false);
      controllers.forEach((controller, id) => {
        if (
          workspace.components.find(
            (c) =>
              c.manifest.id === sources.find((i) => i.id === id)?.componentId,
          )?.manifest.runtime.type === "http"
        )
          controller.abort();
      });
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", reconnected);
    window.addEventListener("offline", disconnected);
    return () => {
      stopped = true;
      stopWatching();
      clearInterval(timer);
      controllers.forEach((c) => c.abort());
      retry.current = () => {};
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", reconnected);
      window.removeEventListener("offline", disconnected);
    };
  }, [sourceKey]);
  const data: Record<string, Snapshot> = {};
  for (const instance of workspace.instances) {
    const component = workspace.components.find(
      (c) => c.manifest.id === instance.componentId,
    )!;
    data[instance.id] = ["http", "codex_usage", "provider_quota"].includes(
      component.manifest.runtime.type,
    )
      ? (remote[instance.id] ?? { metrics: [], loading: true })
      : { metrics: localMetrics(component, instance) };
  }
  return {
    data,
    now,
    online,
    refresh: (id?: string) => retry.current(id, true),
    manualRefreshing: Object.values(data).some(snapshot => snapshot.loading && snapshot.manualLoading),
    receiveQuota: (id: string, quota: CodexUsage) => {
      if (/^[a-f0-9]{64}$/.test(quota.account.key)) cacheCodexUsage(quota);
      setRemote((previous) => ({
        ...previous,
        [id]: {
          metrics: quota.metrics,
          quota,
          observedAt: quota.observedAt,
          receivedAt: new Date().toISOString(),
          sourceDevice: "当前设备",
          lastSuccess: Date.parse(quota.observedAt),
        },
      }));
    },
  };
}
