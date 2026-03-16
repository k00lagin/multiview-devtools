<script setup lang="ts">
import type { ManagerTabInfo } from '@shared/contracts';

const props = defineProps<{
  tabs: ManagerTabInfo[];
}>();

const emit = defineEmits<{
  activate: [runtimeId: number];
  close: [runtimeId: number];
  focus: [runtimeId: number];
  reorder: [fromIndex: number, toIndex: number];
  tabMenu: [payload: { runtimeId: number; point: { x: number; y: number } }];
}>();

function onDragStart(event: DragEvent, index: number) {
  event.dataTransfer?.setData('text/plain', String(index));
}

function onDrop(event: DragEvent, index: number) {
  event.preventDefault();
  const fromIndex = Number(event.dataTransfer?.getData('text/plain'));
  if (!Number.isNaN(fromIndex) && fromIndex !== index) {
    emit('reorder', fromIndex, index);
  }
}
</script>

<template>
  <div class="tabs">
    <div
      v-for="(tab, index) in props.tabs"
      :key="tab.runtimeId"
      :class="[
        'tabs__tab',
        {
          'tabs__tab--active': tab.active,
          'tabs__tab--unloaded': !tab.loaded,
        },
      ]"
      :title="tab.meta.url ? `${tab.meta.title}\n${tab.meta.url}` : tab.meta.title"
      draggable="true"
      :data-id="tab.runtimeId"
      @click="emit('activate', tab.runtimeId)"
      @dblclick="emit('focus', tab.runtimeId)"
      @contextmenu.prevent="
        emit('tabMenu', {
          runtimeId: tab.runtimeId,
          point: { x: $event.clientX, y: $event.clientY },
        })
      "
      @dragstart="onDragStart($event, index)"
      @dragover.prevent
      @drop="onDrop($event, index)"
    >
      <span class="tabs__title">{{ tab.meta.title ?? `wc:${tab.runtimeId}` }}</span>
      <span class="tabs__id">#{{ tab.runtimeId }}</span>
      <button
        class="btn btn--tiny tabs__close"
        type="button"
        title="Close tab"
        @click.stop="emit('close', tab.runtimeId)"
      >
        <svg class="icon">
          <use href="#icon-close" />
        </svg>
      </button>
    </div>
  </div>
</template>
