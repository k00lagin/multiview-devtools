<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ThemeMode } from '@shared/contracts';

const props = defineProps<{
  theme: ThemeMode;
}>();

const emit = defineEmits<{
  select: [theme: ThemeMode];
}>();

const selectElement = ref<HTMLSelectElement | null>(null);

const iconHref = computed(() => {
  if (props.theme === 'light') {
    return '#icon-light-mode';
  }

  if (props.theme === 'dark') {
    return '#icon-dark-mode';
  }

  return '#icon-theme-system';
});

function openPicker() {
  const picker = selectElement.value;
  if (!picker) {
    return;
  }

  try {
    if ('showPicker' in picker) {
      picker.showPicker();
      return;
    }
  } catch {
    // Fall through to click.
  }

  picker.click();
}

function onChange(event: Event) {
  emit('select', (event.target as HTMLSelectElement).value as ThemeMode);
}
</script>

<template>
  <div class="picker">
    <button
      class="btn btn--icon picker__button"
      type="button"
      title="Theme"
      aria-label="Theme"
      @click="openPicker"
    >
      <svg class="icon">
        <use :href="iconHref" />
      </svg>
    </button>

    <select
      ref="selectElement"
      class="picker__select picker__select--hidden"
      title="Theme"
      aria-label="Theme"
      :value="props.theme"
      @change="onChange"
    >
      <option value="system">
        System
      </option>
      <option value="light">
        Light
      </option>
      <option value="dark">
        Dark
      </option>
    </select>
  </div>
</template>
