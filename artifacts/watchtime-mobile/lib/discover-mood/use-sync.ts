import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGetMyMoodDiscoveryStateQueryKey,
  useGetMyMoodDiscoveryState,
  useUpdateMyMoodDiscoveryState,
  type MoodDiscoveryStateUpdate,
} from "@workspace/api-client-react";
import { useAppAuth } from "@/lib/app-auth";
import type { StoreState } from "./types";
import { actions, type MoodPersonalState } from "./store";

export function useMoodDiscoverySync(state: StoreState) {
  const { isLoaded, isSignedIn, userId } = useAppAuth();
  const activeUserId = isLoaded && isSignedIn ? userId : null;
  const scopeKey = activeUserId ?? "guest";
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const currentScope = useRef(scopeKey);
  const previousScope = useRef(scopeKey);
  const lastAppliedState = useRef<string | null>(null);
  const lastSnapshotByScope = useRef(new Map<string, string>());
  const writeQueue = useRef(Promise.resolve());
  const [retryTick, setRetryTick] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const isMounted = useRef(true);
  if (previousScope.current !== scopeKey) {
    lastSnapshotByScope.current.delete(previousScope.current);
    previousScope.current = scopeKey;
  }
  currentScope.current = scopeKey;

  useEffect(() => {
    if (!isLoaded || !state.hydrated) return;
    let current = true;
    setReadyScope(null);
    setLoadedScope(null);
    void actions.setAccountScope(activeUserId).then(() => {
      if (current) setReadyScope(scopeKey);
    });
    return () => {
      current = false;
    };
  }, [isLoaded, state.hydrated, activeUserId, scopeKey]);

  useEffect(
    () => {
      isMounted.current = true;
      return () => {
        isMounted.current = false;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = null;
        retryAttempt.current = 0;
      };
    },
    [scopeKey],
  );

  const queryKey = useMemo(
    () => [...getGetMyMoodDiscoveryStateQueryKey(), activeUserId ?? "guest"],
    [activeUserId],
  );
  const cloudState = useGetMyMoodDiscoveryState({
    query: {
      enabled: !!activeUserId && readyScope === scopeKey,
      queryKey,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const update = useUpdateMyMoodDiscoveryState({ mutation: { retry: 2 } });

  useEffect(() => {
    if (!activeUserId || readyScope !== scopeKey || !cloudState.isSuccess || cloudState.isFetching) return;
    const responseVersion = `${scopeKey}:${cloudState.dataUpdatedAt}`;
    if (lastAppliedState.current === responseVersion) return;
    lastAppliedState.current = responseVersion;
    actions.mergePersonalState(
      cloudState.data.state as unknown as MoodPersonalState,
      cloudState.data.revision,
    );
    setLoadedScope(scopeKey);
  }, [activeUserId, readyScope, scopeKey, cloudState.isSuccess, cloudState.isFetching, cloudState.data, cloudState.dataUpdatedAt]);

  const snapshot = useMemo(
    () => actions.getPersonalSnapshot(),
    [state.saved, state.savedContext, state.dismissed, state.viewed, state.session.feedback],
  );

  useEffect(() => {
    if (!activeUserId || readyScope !== scopeKey || loadedScope !== scopeKey || !state.cloudSyncDirty) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (lastSnapshotByScope.current.get(scopeKey) === snapshot) return;
    lastSnapshotByScope.current.set(scopeKey, snapshot);
    const data = {
      expectedRevision: state.cloudRevision,
      state: JSON.parse(snapshot),
    } as MoodDiscoveryStateUpdate;

    writeQueue.current = writeQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (currentScope.current !== scopeKey) {
          if (lastSnapshotByScope.current.get(scopeKey) === snapshot) {
            lastSnapshotByScope.current.delete(scopeKey);
          }
          return;
        }
        try {
          const result = await update.mutateAsync({ data });
          if (currentScope.current !== scopeKey) {
            if (lastSnapshotByScope.current.get(scopeKey) === snapshot) {
              lastSnapshotByScope.current.delete(scopeKey);
            }
            return;
          }
          if (result.accepted) {
            retryAttempt.current = 0;
            actions.markCloudSyncClean(
              activeUserId,
              snapshot,
              result.state as unknown as MoodPersonalState,
              result.revision,
            );
          } else {
            if (lastSnapshotByScope.current.get(scopeKey) === snapshot) {
              lastSnapshotByScope.current.delete(scopeKey);
            }
            actions.mergePersonalState(
              result.state as unknown as MoodPersonalState,
              result.revision,
            );
          }
        } catch {
          if (lastSnapshotByScope.current.get(scopeKey) === snapshot) {
            lastSnapshotByScope.current.delete(scopeKey);
          }
          if (isMounted.current && currentScope.current === scopeKey) {
            const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retryAttempt.current, 5));
            retryAttempt.current += 1;
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null;
              setRetryTick((tick) => tick + 1);
            }, delay);
          }
        }
      });
  }, [activeUserId, readyScope, loadedScope, scopeKey, snapshot, state.cloudSyncDirty, state.cloudRevision, cloudState.dataUpdatedAt, update.mutateAsync, retryTick]);
}
