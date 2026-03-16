<script setup lang="ts">
import { computed } from 'vue';

import type { ThemeMode, ThemePickerOverlayMenu } from '@shared/contracts';

const props = defineProps<{
  menu: ThemePickerOverlayMenu;
}>();

const emit = defineEmits<{
  close: [];
  selectTheme: [theme: ThemeMode];
}>();

const options: Array<{ value: ThemeMode; label: string; iconHref: string }> = [
  {
    value: 'system',
    label: 'System',
    iconHref: '#icon-theme-system',
  },
  {
    value: 'light',
    label: 'Light',
    iconHref: '#icon-light-mode',
  },
  {
    value: 'dark',
    label: 'Dark',
    iconHref: '#icon-dark-mode',
  },
];

const panelStyle = computed(() => ({
  left: `${props.menu.position.x}px`,
  top: `${props.menu.position.y}px`,
  transform: props.menu.position.align === 'end' ? 'translateX(-100%)' : undefined,
}));
</script>

<template>
  <section class="overlay-card" :style="panelStyle" @mousedown.stop>
    <header class="overlay-card__header">
      <div class="overlay-card__title">Theme</div>
      <div class="overlay-card__hint">{{ props.menu.selectedTheme }}</div>
    </header>

    <div class="overlay-menu">
      <button
        v-for="option in options"
        :key="option.value"
        :class="[
          'overlay-menu__item',
          option.value === props.menu.selectedTheme && 'overlay-menu__item--selected',
        ]"
        type="button"
        @click="emit('selectTheme', option.value)"
      >
        <div class="overlay-menu__label">
          <span>{{ option.label }}</span>
          <span class="overlay-menu__check">
            <svg class="icon">
              <use :href="option.iconHref" />
            </svg>
          </span>
        </div>
      </button>
    </div>
  </section>
</template>
