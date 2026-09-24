<script setup lang="ts">
import { ref } from 'vue';

import { formatShortcut } from '../shortcuts';

const emit = defineEmits<{
  trigger: [anchorRect: DOMRect];
}>();

const buttonElement = ref<HTMLButtonElement | null>(null);
const label = `Open DevTools target (${formatShortcut('T')})`;

function triggerOverlay() {
  const rect = buttonElement.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  emit('trigger', rect);
}

defineExpose({ trigger: triggerOverlay });
</script>

<template>
  <button
    ref="buttonElement"
    class="btn btn--icon"
    type="button"
    :title="label"
    :aria-label="label"
    @click="triggerOverlay"
  >
    <svg class="icon">
      <use href="#icon-plus" />
    </svg>
  </button>
</template>
