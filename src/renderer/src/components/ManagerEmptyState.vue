<script setup lang="ts">
import { formatShortcut } from '../shortcuts';

const props = defineProps<{
  hasTargets: boolean;
}>();
</script>

<template>
  <div class="empty">
    <template v-if="props.hasTargets">
      Press <kbd>{{ formatShortcut('T') }}</kbd> or click + to open a target's DevTools.
    </template>
    <template v-else> No webContents detected. </template>
  </div>
</template>
