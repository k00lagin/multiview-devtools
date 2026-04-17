<script setup lang="ts">
const props = defineProps<{
  hasTargets: boolean;
}>();
</script>

<template>
  <div class="empty">
    <template v-if="props.hasTargets">
      Open a tab from the picker to mount its DevTools frontend.
    </template>
    <template v-else>
      No webContents detected.
    </template>
  </div>
</template>
