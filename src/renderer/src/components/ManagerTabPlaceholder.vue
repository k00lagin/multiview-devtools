<script setup lang="ts">
import { computed } from 'vue';

import type { ManagerTabInfo } from '@shared/contracts';

const props = defineProps<{
  tab: ManagerTabInfo;
}>();

const emit = defineEmits<{
  reload: [runtimeId: number];
  close: [runtimeId: number];
}>();

const title = computed(() => props.tab.meta.title?.trim() || `wc:${props.tab.runtimeId}`);
</script>

<template>
  <div class="placeholder">
    <template v-if="props.tab.status === 'error'">
      <svg class="icon placeholder__icon placeholder__icon--error" aria-hidden="true">
        <use href="#icon-error" />
      </svg>
      <div class="placeholder__title">Couldn't open DevTools for {{ title }}</div>
      <div class="placeholder__detail">{{ props.tab.error }}</div>
      <div class="placeholder__actions">
        <button
          class="action action--primary"
          type="button"
          @click="emit('reload', props.tab.runtimeId)"
        >
          Retry
        </button>
        <button class="action" type="button" @click="emit('close', props.tab.runtimeId)">
          Close tab
        </button>
      </div>
    </template>

    <template v-else-if="props.tab.status === 'loading'">
      <span class="spinner placeholder__icon" aria-hidden="true" />
      <div class="placeholder__title">Attaching DevTools to {{ title }}…</div>
      <div class="placeholder__detail">DevTools opens as soon as the page finishes loading.</div>
    </template>

    <template v-else>
      <div class="placeholder__title">DevTools for {{ title }} is unloaded</div>
      <div class="placeholder__detail">
        The frontend was closed to free memory. The tab stays until you close it.
      </div>
      <div class="placeholder__actions">
        <button
          class="action action--primary"
          type="button"
          @click="emit('reload', props.tab.runtimeId)"
        >
          Reload DevTools
        </button>
      </div>
    </template>
  </div>
</template>
