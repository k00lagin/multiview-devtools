<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ManagerOverlayState, ThemeMode } from '@shared/contracts';

import IconSprite from '../components/IconSprite.vue';
import TabContextMenuOverlay from './TabContextMenuOverlay.vue';
import TargetPickerOverlay from './TargetPickerOverlay.vue';
import ThemeMenuOverlay from './ThemeMenuOverlay.vue';

const overlayState = ref<ManagerOverlayState>({
  open: false,
  menu: null,
});

let unsubscribe: (() => void) | undefined;

const currentTheme = computed<ThemeMode>(() => overlayState.value.menu?.theme ?? 'system');
const menuKey = computed(() => {
  const menu = overlayState.value.menu;
  if (!menu) {
    return 'closed';
  }

  return `${menu.kind}:${menu.position.x}:${menu.position.y}:${'runtimeId' in menu ? menu.runtimeId : 'global'}`;
});

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
}

async function closeOverlay() {
  await window.multiviewDevtools.closeOverlay();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && overlayState.value.open) {
    event.preventDefault();
    void closeOverlay();
  }
}

async function handleTargetSelect(runtimeId: number) {
  await window.multiviewDevtools.openTab(runtimeId);
  await closeOverlay();
}

async function handleThemeSelect(theme: ThemeMode) {
  await window.multiviewDevtools.setTheme(theme);
  await closeOverlay();
}

async function handleTabAction(action: string, runtimeId: number) {
  switch (action) {
    case 'unload':
      await window.multiviewDevtools.unloadTab(runtimeId);
      break;
    case 'close':
      await window.multiviewDevtools.closeTab(runtimeId);
      break;
    case 'close-left':
      await window.multiviewDevtools.closeTabsLeftOf(runtimeId);
      break;
    case 'close-right':
      await window.multiviewDevtools.closeTabsRightOf(runtimeId);
      break;
    case 'close-others':
      await window.multiviewDevtools.closeOtherTabs(runtimeId);
      break;
    case 'focus-source':
      await window.multiviewDevtools.focusSource(runtimeId);
      break;
    default:
      return;
  }

  await closeOverlay();
}

onMounted(async () => {
  overlayState.value = await window.multiviewDevtools.getOverlayState();
  unsubscribe = window.multiviewDevtools.subscribeOverlay((nextState) => {
    overlayState.value = nextState;
  });
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', handleKeydown);
});

watch(
  currentTheme,
  (theme) => {
    applyTheme(theme);
  },
  { immediate: true },
);
</script>

<template>
  <div class="overlay-root">
    <IconSprite />

    <div
      v-if="overlayState.open && overlayState.menu"
      class="overlay-backdrop"
      @mousedown.self="closeOverlay"
    >
      <TargetPickerOverlay
        v-if="overlayState.menu.kind === 'target-picker'"
        :key="menuKey"
        :menu="overlayState.menu"
        @close="closeOverlay"
        @select-runtime="handleTargetSelect"
      />

      <ThemeMenuOverlay
        v-else-if="overlayState.menu.kind === 'theme-picker'"
        :key="menuKey"
        :menu="overlayState.menu"
        @close="closeOverlay"
        @select-theme="handleThemeSelect"
      />

      <TabContextMenuOverlay
        v-else
        :key="menuKey"
        :menu="overlayState.menu"
        @close="closeOverlay"
        @action="handleTabAction"
      />
    </div>
  </div>
</template>
