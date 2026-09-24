<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { ManagerTargetInfo, TargetPickerOverlayMenu } from '@shared/contracts';

const props = defineProps<{
  menu: TargetPickerOverlayMenu;
}>();

const emit = defineEmits<{
  close: [];
  selectRuntime: [runtimeId: number];
}>();

const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const listElement = ref<HTMLElement | null>(null);
const highlightedIndex = ref(0);

const openTabIds = computed(() => new Set(props.menu.openTabIds));
const hasTargets = computed(() => props.menu.targets.length > 0);
const sortedTargets = computed(() =>
  [...props.menu.targets].sort((left, right) => left.runtimeId - right.runtimeId),
);

function buildSearchText(target: ManagerTargetInfo) {
  return [
    target.runtimeId,
    target.meta.title,
    target.meta.url,
    target.meta.hostname,
    target.meta.type,
    target.meta.ownerWindowTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const filteredTargets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return sortedTargets.value;
  }

  return sortedTargets.value.filter((target) => buildSearchText(target).includes(query));
});

const highlightedTarget = computed(() => filteredTargets.value[highlightedIndex.value]);

function optionId(target: ManagerTargetInfo) {
  return `target-option-${target.runtimeId}`;
}

function targetTrail(target: ManagerTargetInfo) {
  const parts = [`#${target.runtimeId}`];
  if (target.autoDetected) {
    parts.push('auto');
  }
  if (openTabIds.value.has(target.runtimeId)) {
    parts.push(props.menu.activeTabId === target.runtimeId ? 'active' : 'open');
  }

  return parts.join(' · ');
}

function panelStyle() {
  return {
    left: `${props.menu.position.x}px`,
    top: `${props.menu.position.y}px`,
    transform: props.menu.position.align === 'end' ? 'translateX(-100%)' : undefined,
  };
}

function targetSubtitle(target: ManagerTargetInfo) {
  return (
    target.meta.hostname ||
    target.meta.url ||
    target.meta.ownerWindowTitle ||
    target.meta.type ||
    'Untitled renderer'
  );
}

function moveHighlight(step: 1 | -1) {
  const count = filteredTargets.value.length;
  if (!count) {
    return;
  }

  highlightedIndex.value = (highlightedIndex.value + step + count) % count;
  void nextTick(() => {
    listElement.value
      ?.querySelector('.overlay-target--highlighted')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveHighlight(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveHighlight(-1);
      break;
    case 'Enter':
      event.preventDefault();
      if (highlightedTarget.value) {
        emit('selectRuntime', highlightedTarget.value.runtimeId);
      }
      break;
  }
}

watch(searchQuery, () => {
  highlightedIndex.value = 0;
});

onMounted(() => {
  void nextTick(() => {
    searchInput.value?.focus();
    searchInput.value?.select();
  });
});
</script>

<template>
  <section class="overlay-card overlay-card--picker" :style="panelStyle()" @mousedown.stop>
    <header class="overlay-card__header">
      <div class="overlay-card__title">Open DevTools target</div>
      <div class="overlay-card__hint">{{ props.menu.targets.length }} detected</div>
    </header>

    <div class="overlay-search">
      <input
        ref="searchInput"
        v-model="searchQuery"
        class="overlay-search__input"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="target-picker-list"
        :aria-activedescendant="highlightedTarget ? optionId(highlightedTarget) : undefined"
        placeholder="Search by title, id, hostname, or URL"
        @keydown="onSearchKeydown"
      />
    </div>

    <div id="target-picker-list" ref="listElement" class="overlay-list" role="listbox">
      <button
        v-for="(target, index) in filteredTargets"
        :id="optionId(target)"
        :key="target.runtimeId"
        :class="['overlay-target', index === highlightedIndex && 'overlay-target--highlighted']"
        type="button"
        role="option"
        tabindex="-1"
        :aria-selected="index === highlightedIndex"
        @mousemove="highlightedIndex = index"
        @click="emit('selectRuntime', target.runtimeId)"
      >
        <div class="overlay-target__row">
          <div class="overlay-target__title">
            {{ target.meta.title?.trim() || `wc:${target.runtimeId}` }}
          </div>

          <div class="overlay-target__trail">
            {{ targetTrail(target) }}
          </div>
        </div>

        <div class="overlay-target__meta">
          <span>{{ targetSubtitle(target) }}</span>
          <span v-if="target.meta.ownerWindowTitle">
            {{ target.meta.ownerWindowTitle }}
          </span>
        </div>
      </button>

      <div v-if="!hasTargets" class="overlay-list__empty">
        No managed webContents are available yet.
      </div>

      <div v-else-if="!filteredTargets.length" class="overlay-list__empty">
        No targets match this query.
      </div>
    </div>

    <footer v-if="filteredTargets.length" class="overlay-card__footer" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span><kbd>Enter</kbd> open</span>
      <span><kbd>Esc</kbd> close</span>
    </footer>
  </section>
</template>
