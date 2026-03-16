<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ThemeMode } from '@shared/contracts';

const props = defineProps<{
  theme: ThemeMode;
}>();

const emit = defineEmits<{
  trigger: [anchorRect: DOMRect];
}>();

const buttonElement = ref<HTMLButtonElement | null>(null);

const iconHref = computed(() => {
  if (props.theme === 'light') {
    return '#icon-light-mode';
  }

  if (props.theme === 'dark') {
    return '#icon-dark-mode';
  }

  return '#icon-theme-system';
});

function triggerOverlay() {
  const rect = buttonElement.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  emit('trigger', rect);
}
</script>

<template>
  <button
    ref="buttonElement"
    class="btn btn--icon"
    type="button"
    title="Theme"
    aria-label="Theme"
    @click="triggerOverlay"
  >
    <svg class="icon">
      <use :href="iconHref" />
    </svg>
  </button>
</template>
