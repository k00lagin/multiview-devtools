<script setup lang="ts">
import { computed } from 'vue';

import type { TabContextMenuOverlayMenu } from '@shared/contracts';

const props = defineProps<{
  menu: TabContextMenuOverlayMenu;
}>();

const emit = defineEmits<{
  close: [];
  action: [action: string, runtimeId: number];
}>();

const panelStyle = computed(() => ({
  left: `${props.menu.position.x}px`,
  top: `${props.menu.position.y}px`,
  transform: props.menu.position.align === 'end' ? 'translateX(-100%)' : undefined,
}));

const title = computed(() => props.menu.tab.meta.title?.trim() || `wc:${props.menu.runtimeId}`);
</script>

<template>
  <section class="overlay-card" :style="panelStyle" @mousedown.stop>
    <header class="overlay-card__header">
      <div class="overlay-card__title">
        {{ title }}
      </div>
      <div class="overlay-card__hint">#{{ props.menu.runtimeId }}</div>
    </header>

    <div class="overlay-menu">
      <button
        class="overlay-menu__item"
        type="button"
        @click="emit('action', 'focus-source', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Focus Source Target</div>
      </button>

      <div class="overlay-menu__separator" />

      <button
        class="overlay-menu__item"
        type="button"
        :disabled="!props.menu.canUnload"
        @click="emit('action', 'unload', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Unload tab</div>
      </button>

      <button
        class="overlay-menu__item"
        type="button"
        @click="emit('action', 'close', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Close tab</div>
      </button>

      <button
        class="overlay-menu__item"
        type="button"
        :disabled="!props.menu.canCloseLeft"
        @click="emit('action', 'close-left', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Close left</div>
      </button>

      <button
        class="overlay-menu__item"
        type="button"
        :disabled="!props.menu.canCloseRight"
        @click="emit('action', 'close-right', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Close right</div>
      </button>

      <button
        class="overlay-menu__item"
        type="button"
        :disabled="!props.menu.canCloseOthers"
        @click="emit('action', 'close-others', props.menu.runtimeId)"
      >
        <div class="overlay-menu__label">Close others</div>
      </button>
    </div>
  </section>
</template>
