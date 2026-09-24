<script setup lang="ts">
import type { ManagerNotice } from '@shared/contracts';

const props = defineProps<{
  notice: ManagerNotice;
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();
</script>

<template>
  <div
    :class="['notice', `notice--${props.notice.tone}`]"
    :role="props.notice.tone === 'error' ? 'alert' : 'status'"
    :title="props.notice.message"
  >
    <svg class="icon notice__icon" aria-hidden="true">
      <use :href="props.notice.tone === 'error' ? '#icon-error' : '#icon-info'" />
    </svg>
    <span class="notice__message">{{ props.notice.message }}</span>
    <button
      class="btn btn--tiny"
      type="button"
      title="Dismiss"
      aria-label="Dismiss"
      @click="emit('dismiss', props.notice.id)"
    >
      <svg class="icon">
        <use href="#icon-close" />
      </svg>
    </button>
  </div>
</template>
