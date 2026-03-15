import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { ManagerSnapshot, ThemeMode } from '@shared/contracts';

const emptySnapshot: ManagerSnapshot = {
  targets: [],
  tabs: [],
  activeTabId: null,
  uiState: {},
};

export function useManagerState() {
  const snapshot = ref<ManagerSnapshot>(emptySnapshot);
  let unsubscribe: (() => void) | undefined;

  onMounted(async () => {
    snapshot.value = await window.multiviewDevtools.getSnapshot();
    unsubscribe = window.multiviewDevtools.subscribe((nextSnapshot) => {
      snapshot.value = nextSnapshot;
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
  });

  async function refreshTargets() {
    await window.multiviewDevtools.refreshTargets();
  }

  async function openTab(runtimeId: number) {
    await window.multiviewDevtools.openTab(runtimeId);
  }

  async function activateTab(runtimeId: number) {
    await window.multiviewDevtools.activateTab(runtimeId);
  }

  async function unloadTab(runtimeId: number) {
    await window.multiviewDevtools.unloadTab(runtimeId);
  }

  async function closeTab(runtimeId: number) {
    await window.multiviewDevtools.closeTab(runtimeId);
  }

  async function closeTabsLeftOf(runtimeId: number) {
    await window.multiviewDevtools.closeTabsLeftOf(runtimeId);
  }

  async function closeTabsRightOf(runtimeId: number) {
    await window.multiviewDevtools.closeTabsRightOf(runtimeId);
  }

  async function closeOtherTabs(runtimeId: number) {
    await window.multiviewDevtools.closeOtherTabs(runtimeId);
  }

  async function focusSource(runtimeId: number) {
    await window.multiviewDevtools.focusSource(runtimeId);
  }

  async function setTheme(theme: ThemeMode) {
    await window.multiviewDevtools.setTheme(theme);
  }

  return {
    snapshot,
    refreshTargets,
    openTab,
    activateTab,
    unloadTab,
    closeTab,
    closeTabsLeftOf,
    closeTabsRightOf,
    closeOtherTabs,
    focusSource,
    setTheme,
  };
}
