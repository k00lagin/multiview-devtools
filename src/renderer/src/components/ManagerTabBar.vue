<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

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

const tabsScroller = ref<HTMLElement | null>(null);
const draggingIndex = ref<number | null>(null);
const dropSlot = ref<number | null>(null);
const pinVisible = ref(false);
const isScrollable = ref(false);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);
const scrollActive = ref(false);
const scrollbarHover = ref(false);
const scrollbarDragging = ref(false);
const scrollLeft = ref(0);
const scrollViewportWidth = ref(0);
const scrollContentWidth = ref(0);

let scrollActiveTimer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let scrollbarDragStartX = 0;
let scrollbarDragStartScrollLeft = 0;

const SCROLLBAR_TRACK_END_INSET = 10;
const MIN_SCROLLBAR_THUMB_WIDTH = 28;

function getTabElements() {
  const container = tabsScroller.value;
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>('.tabs__tab'));
}

function updateScrollState() {
  const container = tabsScroller.value;
  if (!container) {
    isScrollable.value = false;
    canScrollLeft.value = false;
    canScrollRight.value = false;
    scrollLeft.value = 0;
    scrollViewportWidth.value = 0;
    scrollContentWidth.value = 0;
    return;
  }

  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  scrollLeft.value = container.scrollLeft;
  scrollViewportWidth.value = container.clientWidth;
  scrollContentWidth.value = container.scrollWidth;
  isScrollable.value = maxScrollLeft > 1;
  canScrollLeft.value = isScrollable.value && container.scrollLeft > 1;
  canScrollRight.value = isScrollable.value && container.scrollLeft < maxScrollLeft - 1;
}

function scheduleScrollStateUpdate() {
  void nextTick(updateScrollState);
}

function markScrollActive() {
  scrollActive.value = true;
  if (scrollActiveTimer != null) {
    window.clearTimeout(scrollActiveTimer);
  }
  scrollActiveTimer = window.setTimeout(() => {
    scrollActive.value = false;
    scrollActiveTimer = null;
  }, 520);
}

function clearScrollActiveTimer() {
  if (scrollActiveTimer != null) {
    window.clearTimeout(scrollActiveTimer);
    scrollActiveTimer = null;
  }
}

function clearScrollbarDrag() {
  scrollbarDragging.value = false;
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerUp);
}

function getScrollbarMetrics(trackWidth = Math.max(0, scrollViewportWidth.value - SCROLLBAR_TRACK_END_INSET)) {
  if (!isScrollable.value || trackWidth <= 0 || scrollViewportWidth.value <= 0) {
    return null;
  }

  const maxScrollLeft = Math.max(0, scrollContentWidth.value - scrollViewportWidth.value);
  const thumbWidth = Math.min(
    trackWidth,
    Math.max(MIN_SCROLLBAR_THUMB_WIDTH, (scrollViewportWidth.value / scrollContentWidth.value) * trackWidth),
  );
  const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);

  return {
    maxScrollLeft,
    maxThumbOffset,
    thumbWidth,
  };
}

function resolveDropSlot(clientX: number) {
  const container = tabsScroller.value;
  const children = getTabElements();
  if (!container || !children.length) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const contentX = clientX - containerRect.left + container.scrollLeft;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const midpoint = child.offsetLeft + child.offsetWidth / 2;
    if (contentX < midpoint) {
      return index;
    }
  }

  return children.length;
}

const pinStyle = computed<Record<string, string> | undefined>(() => {
  if (dropSlot.value == null || !tabsScroller.value) {
    return undefined;
  }

  const children = getTabElements();
  if (!children.length) {
    return undefined;
  }

  const slot = dropSlot.value;
  let centerX: number;

  if (slot <= 0) {
    const first = children[0]!;
    centerX = first.offsetLeft - 3;
  } else if (slot >= children.length) {
    const last = children[children.length - 1]!;
    centerX = last.offsetLeft + last.offsetWidth + 3;
  } else {
    const prev = children[slot - 1]!;
    const next = children[slot]!;
    centerX = (prev.offsetLeft + prev.offsetWidth + next.offsetLeft) / 2;
  }

  return {
    transform: `translateX(${Math.round(centerX)}px)`,
    opacity: pinVisible.value ? '1' : '0',
  };
});

const scrollbarVisible = computed(
  () =>
    draggingIndex.value == null &&
    isScrollable.value &&
    (scrollActive.value || scrollbarHover.value || scrollbarDragging.value),
);

const scrollbarThumbStyle = computed<Record<string, string> | undefined>(() => {
  const metrics = getScrollbarMetrics();
  if (!metrics) {
    return undefined;
  }

  const thumbOffset =
    metrics.maxScrollLeft > 0
      ? (scrollLeft.value / metrics.maxScrollLeft) * metrics.maxThumbOffset
      : 0;

  return {
    width: `${Math.round(metrics.thumbWidth)}px`,
    transform: `translateX(${Math.round(thumbOffset)}px)`,
  };
});

function onDragStart(event: DragEvent, index: number) {
  event.dataTransfer?.setData('text/plain', String(index));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  draggingIndex.value = index;
  dropSlot.value = index;
  pinVisible.value = false;
  requestAnimationFrame(() => {
    pinVisible.value = true;
  });
  scheduleScrollStateUpdate();
}

function onContainerDragOver(event: DragEvent) {
  if (draggingIndex.value == null) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  const slot = resolveDropSlot(event.clientX);
  if (slot != null) {
    dropSlot.value = slot;
    pinVisible.value = true;
  }
}

function onTabDragOver(event: DragEvent) {
  onContainerDragOver(event);
}

function onContainerDragLeave(event: DragEvent) {
  const container = tabsScroller.value;
  if (!container) {
    return;
  }

  const rect = container.getBoundingClientRect();
  const isInsideContainer =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  if (isInsideContainer) {
    return;
  }
  dropSlot.value = null;
  pinVisible.value = false;
}

function resetDrag() {
  draggingIndex.value = null;
  dropSlot.value = null;
  pinVisible.value = false;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  const from = draggingIndex.value;
  const slot = dropSlot.value;
  if (from == null || slot == null) {
    resetDrag();
    return;
  }

  let to = slot;
  if (to > from) {
    to -= 1;
  }
  if (to !== from) {
    emit('reorder', from, to);
  }
  resetDrag();
}

function onDragEnd() {
  resetDrag();
}

function onScroll() {
  markScrollActive();
  updateScrollState();
}

function syncScrollFromTrack(clientX: number, trackElement: HTMLElement) {
  const container = tabsScroller.value;
  if (!container) {
    return;
  }

  const rect = trackElement.getBoundingClientRect();
  const metrics = getScrollbarMetrics(rect.width);
  if (!metrics) {
    return;
  }

  const relativeX = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const thumbOffset = Math.min(
    metrics.maxThumbOffset,
    Math.max(0, relativeX - metrics.thumbWidth / 2),
  );
  const ratio = metrics.maxThumbOffset > 0 ? thumbOffset / metrics.maxThumbOffset : 0;

  container.scrollLeft = ratio * metrics.maxScrollLeft;
  markScrollActive();
  updateScrollState();
}

function beginScrollbarDrag(clientX: number) {
  const container = tabsScroller.value;
  if (!container) {
    return;
  }

  scrollbarDragging.value = true;
  scrollbarDragStartX = clientX;
  scrollbarDragStartScrollLeft = container.scrollLeft;
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);
}

function onScrollbarPointerEnter() {
  if (isScrollable.value) {
    scrollbarHover.value = true;
  }
}

function onScrollbarPointerLeave() {
  if (!scrollbarDragging.value) {
    scrollbarHover.value = false;
  }
}

function onScrollbarTrackPointerDown(event: PointerEvent) {
  if (!isScrollable.value) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && target.closest('.tabs-scrollbar__thumb')) {
    return;
  }

  const trackElement = event.currentTarget;
  if (!(trackElement instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  scrollbarHover.value = true;
  syncScrollFromTrack(event.clientX, trackElement);
  beginScrollbarDrag(event.clientX);
}

function onScrollbarThumbPointerDown(event: PointerEvent) {
  if (!isScrollable.value) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  scrollbarHover.value = true;
  beginScrollbarDrag(event.clientX);
}

function onWindowPointerMove(event: PointerEvent) {
  if (!scrollbarDragging.value) {
    return;
  }

  const container = tabsScroller.value;
  const metrics = getScrollbarMetrics();
  if (!container || !metrics || metrics.maxThumbOffset <= 0) {
    return;
  }

  const deltaX = event.clientX - scrollbarDragStartX;
  const scrollDelta = (deltaX / metrics.maxThumbOffset) * metrics.maxScrollLeft;
  const nextScrollLeft = Math.min(
    metrics.maxScrollLeft,
    Math.max(0, scrollbarDragStartScrollLeft + scrollDelta),
  );

  container.scrollLeft = nextScrollLeft;
  markScrollActive();
  updateScrollState();
}

function onWindowPointerUp(event: PointerEvent) {
  const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
  scrollbarHover.value = Boolean(hoveredElement?.closest('.tabs-scrollbar'));
  clearScrollbarDrag();
}

function normalizeWheelDelta(event: WheelEvent, container: HTMLElement) {
  const rawDelta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return rawDelta * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return rawDelta * container.clientWidth * 0.85;
    default:
      return rawDelta;
  }
}

function onWheel(event: WheelEvent) {
  const container = tabsScroller.value;
  if (!container || draggingIndex.value != null || event.ctrlKey) {
    return;
  }

  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  if (maxScrollLeft <= 1) {
    return;
  }

  const delta = normalizeWheelDelta(event, container);
  if (delta === 0) {
    return;
  }

  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, container.scrollLeft + delta));
  if (Math.abs(nextScrollLeft - container.scrollLeft) < 1) {
    return;
  }

  event.preventDefault();
  container.scrollLeft = nextScrollLeft;
  markScrollActive();
  updateScrollState();
}

onMounted(() => {
  scheduleScrollStateUpdate();

  if (typeof ResizeObserver !== 'undefined' && tabsScroller.value) {
    resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(tabsScroller.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  clearScrollActiveTimer();
  clearScrollbarDrag();
});

watch(
  () => props.tabs,
  () => {
    scheduleScrollStateUpdate();
  },
  { deep: true, flush: 'post' },
);
</script>

<template>
  <div
    :class="[
      'tabs-shell',
      {
        'tabs-shell--scrollable': isScrollable,
        'tabs-shell--can-left': canScrollLeft,
        'tabs-shell--can-right': canScrollRight,
        'tabs-shell--scroll-active': scrollActive,
        'tabs-shell--dragging-tab': draggingIndex !== null,
      },
    ]"
  >
    <div
      ref="tabsScroller"
      class="tabs"
      @dragover="onContainerDragOver"
      @dragleave="onContainerDragLeave"
      @drop="onDrop"
      @scroll="onScroll"
      @wheel="onWheel"
    >
      <div
        v-for="(tab, index) in props.tabs"
        :key="tab.runtimeId"
        :class="[
          'tabs__tab',
          {
            'tabs__tab--active': tab.active,
            'tabs__tab--unloaded': !tab.loaded,
            'tabs__tab--dragging': draggingIndex === index,
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
        @dragover="onTabDragOver"
        @dragend="onDragEnd"
        @drop.stop="onDrop($event)"
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

      <div
        v-if="draggingIndex !== null && dropSlot !== null"
        class="tabs__drop-pin"
        :style="pinStyle"
      />
    </div>

    <div
      :class="[
        'tabs-scrollbar',
        {
          'tabs-scrollbar--visible': scrollbarVisible,
        },
      ]"
      aria-hidden="true"
      @pointerenter="onScrollbarPointerEnter"
      @pointerleave="onScrollbarPointerLeave"
    >
      <div class="tabs-scrollbar__track" @pointerdown="onScrollbarTrackPointerDown">
        <div
          class="tabs-scrollbar__thumb"
          :class="{ 'tabs-scrollbar__thumb--dragging': scrollbarDragging }"
          :style="scrollbarThumbStyle"
          @pointerdown="onScrollbarThumbPointerDown"
        />
      </div>
    </div>
  </div>
</template>
