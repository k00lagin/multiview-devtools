<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  trigger: [anchorRect: DOMRect];
}>();

const buttonElement = ref<HTMLButtonElement | null>(null);

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
    title="Add tab"
    aria-label="Add tab"
    @click="triggerOverlay"
  >
    <svg class="icon">
      <use href="#icon-plus" />
    </svg>
  </button>
</template>
