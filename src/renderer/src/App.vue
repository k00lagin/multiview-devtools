<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { ManagerTabInfo, ThemeMode } from '@shared/contracts';

import IconSprite from './components/IconSprite.vue';
import ManagerEmptyState from './components/ManagerEmptyState.vue';
import ManagerTabBar from './components/ManagerTabBar.vue';
import TargetPickerButton from './components/TargetPickerButton.vue';
import ThemePickerButton from './components/ThemePickerButton.vue';
import { useManagerState } from './composables/useManagerState';

const { snapshot, refreshTargets, activateTab, closeTab, focusSource } = useManagerState();

const selectedTheme = computed<ThemeMode>(() => snapshot.value.uiState.theme ?? 'system');
const visibleOrder = ref<number[]>([]);

const orderedTabs = computed(() => {
  const tabMap = new Map(snapshot.value.tabs.map((tab) => [tab.runtimeId, tab]));
  return visibleOrder.value
    .map((runtimeId) => tabMap.get(runtimeId))
    .filter((tab): tab is ManagerTabInfo => Boolean(tab));
});

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

function syncVisibleOrder(runtimeIds: number[]) {
  const nextOrder = visibleOrder.value.filter((runtimeId) => runtimeIds.includes(runtimeId));
  for (const runtimeId of runtimeIds) {
    if (!nextOrder.includes(runtimeId)) {
      nextOrder.push(runtimeId);
    }
  }
  visibleOrder.value = nextOrder;
}

function reorderTabs(fromIndex: number, toIndex: number) {
  const nextOrder = [...visibleOrder.value];
  const [moved] = nextOrder.splice(fromIndex, 1);
  if (moved == null) {
    return;
  }

  nextOrder.splice(toIndex, 0, moved);
  visibleOrder.value = nextOrder;
}

function cycleTab(direction: 1 | -1) {
  const tabs = orderedTabs.value;
  if (!tabs.length) {
    return;
  }

  const currentIndex = tabs.findIndex((tab) => tab.active);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  if (nextTab) {
    void activateTab(nextTab.runtimeId);
  }
}

function toPlainRect(rect: DOMRect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

async function openTargetPicker(anchorRect: DOMRect) {
  await window.multiviewDevtools.openOverlay({
    kind: 'target-picker',
    anchorRect: toPlainRect(anchorRect),
  });
}

async function openThemePicker(anchorRect: DOMRect) {
  await window.multiviewDevtools.openOverlay({
    kind: 'theme-picker',
    anchorRect: toPlainRect(anchorRect),
  });
}

async function openTabContextMenu(payload: { runtimeId: number; point: { x: number; y: number } }) {
  await window.multiviewDevtools.openOverlay({
    kind: 'tab-context-menu',
    runtimeId: payload.runtimeId,
    point: payload.point,
  });
}

function handleKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (event.key.toLowerCase() === 'w' && snapshot.value.activeTabId != null) {
    event.preventDefault();
    void closeTab(snapshot.value.activeTabId);
    return;
  }

  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault();
    cycleTab(-1);
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    cycleTab(1);
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

watch(
  () => snapshot.value.tabs.map((tab) => tab.runtimeId),
  (runtimeIds) => {
    syncVisibleOrder(runtimeIds);
  },
  { immediate: true },
);

watch(
  selectedTheme,
  (theme) => {
    applyTheme(theme);
  },
  { immediate: true },
);
</script>

<template>
  <div class="manager-shell">
    <IconSprite />

    <header class="toolbar">
      <ManagerTabBar
        :tabs="orderedTabs"
        @activate="activateTab"
        @close="closeTab"
        @focus="focusSource"
        @reorder="reorderTabs"
        @tab-menu="openTabContextMenu"
      />

      <TargetPickerButton @trigger="openTargetPicker" />

      <ThemePickerButton
        :theme="selectedTheme"
        @trigger="openThemePicker"
      />

      <button
        class="btn btn--icon"
        type="button"
        title="Refresh list"
        aria-label="Refresh list"
        @click="refreshTargets"
      >
        <svg class="icon">
          <use href="#icon-refresh" />
        </svg>
      </button>
    </header>

    <main>
      <ManagerEmptyState
        v-if="!orderedTabs.length"
        :has-targets="snapshot.targets.length > 0"
      />
    </main>
  </div>
</template>
