<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ManagerTargetInfo } from '@shared/contracts';

const props = defineProps<{
  targets: ManagerTargetInfo[];
}>();

const emit = defineEmits<{
  select: [runtimeId: number];
}>();

const selectElement = ref<HTMLSelectElement | null>(null);

const sortedTargets = computed(() =>
  [...props.targets].sort((left, right) => left.runtimeId - right.runtimeId),
);

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
  const runtimeId = Number((event.target as HTMLSelectElement).value);
  if (Number.isFinite(runtimeId)) {
    emit('select', runtimeId);
  }

  if (selectElement.value) {
    selectElement.value.value = '';
  }
}
</script>

<template>
  <div class="picker">
    <button
      class="btn btn--icon picker__button"
      type="button"
      title="Add tab"
      aria-label="Add tab"
      @click="openPicker"
    >
      <svg class="icon">
        <use href="#icon-plus" />
      </svg>
    </button>

    <select
      ref="selectElement"
      class="picker__select picker__select--hidden"
      title="Add tab"
      aria-label="Add tab"
      @change="onChange"
    >
      <option
        value=""
        disabled
        selected
      >
        Add tab…
      </option>
      <option
        v-for="target in sortedTargets"
        :key="target.runtimeId"
        :value="target.runtimeId"
      >
        {{ target.runtimeId }}: {{ target.meta.title?.trim() || `wc:${target.runtimeId}` }}
      </option>
    </select>
  </div>
</template>
