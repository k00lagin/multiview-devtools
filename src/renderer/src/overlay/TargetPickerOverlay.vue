<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

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

onMounted(() => {
  void nextTick(() => {
    searchInput.value?.focus();
    searchInput.value?.select();
  });
});
</script>

<template>
  <section
    class="overlay-card overlay-card--picker"
    :style="panelStyle()"
    @mousedown.stop
  >
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
        placeholder="Search by title, id, hostname, or URL"
      />
    </div>

    <div class="overlay-list">
      <button
        v-for="target in filteredTargets"
        :key="target.runtimeId"
        class="overlay-target"
        type="button"
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

      <div
        v-if="!hasTargets"
        class="overlay-list__empty"
      >
        No managed webContents are available yet.
      </div>

      <div
        v-else-if="!filteredTargets.length"
        class="overlay-list__empty"
      >
        No targets match this query.
      </div>
    </div>
  </section>
</template>
