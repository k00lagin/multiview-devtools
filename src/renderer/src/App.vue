<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { ThemeMode } from '@shared/contracts';

import IconSprite from './components/IconSprite.vue';
import ManagerEmptyState from './components/ManagerEmptyState.vue';
import ManagerNoticeChip from './components/ManagerNoticeChip.vue';
import ManagerTabBar from './components/ManagerTabBar.vue';
import ManagerTabPlaceholder from './components/ManagerTabPlaceholder.vue';
import TargetPickerButton from './components/TargetPickerButton.vue';
import ThemePickerButton from './components/ThemePickerButton.vue';
import { useManagerState } from './composables/useManagerState';

const { snapshot, refreshTargets, activateTab, closeTab, moveTab, dismissNotice, focusSource } =
  useManagerState();

const targetPickerButton = ref<InstanceType<typeof TargetPickerButton> | null>(null);
const selectedTheme = computed<ThemeMode>(() => snapshot.value.uiState.theme ?? 'system');
const activeTab = computed(() => snapshot.value.tabs.find((tab) => tab.active) ?? null);
const latestNotice = computed(() => snapshot.value.notices.at(-1) ?? null);

let unsubscribeCommands: (() => void) | undefined;

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

function reorderTabs(fromIndex: number, toIndex: number) {
  const tab = snapshot.value.tabs[fromIndex];
  if (tab) {
    void moveTab(tab.runtimeId, toIndex);
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

// Keyboard shortcuts are handled in main so they also work while a DevTools view has focus.
// Main only asks the UI to open the picker, because the picker is anchored to the + button.
onMounted(() => {
  unsubscribeCommands = window.multiviewDevtools.subscribeCommands((command) => {
    if (command === 'open-target-picker') {
      targetPickerButton.value?.trigger();
    }
  });
});

onUnmounted(() => {
  unsubscribeCommands?.();
});

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
        :tabs="snapshot.tabs"
        @activate="activateTab"
        @close="closeTab"
        @focus="focusSource"
        @reorder="reorderTabs"
        @tab-menu="openTabContextMenu"
      />

      <TargetPickerButton ref="targetPickerButton" @trigger="openTargetPicker" />

      <ManagerNoticeChip
        v-if="latestNotice"
        :key="latestNotice.id"
        :notice="latestNotice"
        @dismiss="dismissNotice"
      />

      <ThemePickerButton :theme="selectedTheme" @trigger="openThemePicker" />

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
      <ManagerEmptyState v-if="!snapshot.tabs.length" :has-targets="snapshot.targets.length > 0" />
      <ManagerTabPlaceholder
        v-else-if="activeTab && activeTab.status !== 'ready'"
        :tab="activeTab"
        @reload="activateTab"
        @close="closeTab"
      />
    </main>
  </div>
</template>
