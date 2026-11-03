<script setup lang="ts" generic="Row">
/**
 * A table with columns: the one style for tables in the lab. A cell shows `row[key]`, or the `cell-<key>` slot. With
 * `rowKey` and `selected`, a click selects a row and a double click opens it; with `sortKey`, headings of sortable
 * columns sort.
 */
export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /** A CSS width, like `120px`. */
  width?: string;
  sortable?: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: Column[];
    rows: readonly Row[];
    rowKey: (row: Row, index: number) => string;
    selected?: string;
    /** Extra classes for a row, like faded text. */
    rowClass?: (row: Row) => string | undefined;
    sortKey?: string;
    sortDir?: 1 | -1;
    /** Less space between columns, for narrow panels. */
    compact?: boolean;
  }>(),
  { selected: undefined, rowClass: undefined, sortKey: undefined, sortDir: 1, compact: false },
);
const emit = defineEmits<{ select: [key: string]; open: [key: string]; sort: [key: string] }>();

const selectable = () => props.selected !== undefined;
const cell = (row: Row, key: string) => String((row as Record<string, unknown>)[key] ?? "");
const ariaSort = (c: Column) =>
  c.key === props.sortKey ? (props.sortDir === 1 ? "ascending" : "descending") : c.sortable ? "none" : undefined;
const heading = () =>
  `flex h-7 w-full items-center gap-1 ${props.compact ? "px-2" : "px-3"} text-label font-semibold tracking-[.06em] text-muted uppercase`;
</script>

<template>
  <table class="w-full border-separate border-spacing-0">
    <thead>
      <tr class="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-line [&_th]:bg-sunken [&_th]:p-0">
        <th v-for="c in columns" :key="c.key" :style="{ width: c.width }" :aria-sort="ariaSort(c)">
          <button
            v-if="c.sortable"
            type="button"
            :class="[heading(), c.align === 'right' && 'justify-end']"
            class="cursor-pointer hover:text-ink focus-visible:-outline-offset-2"
            @click="emit('sort', c.key)"
          >
            {{ c.label }}
            <span class="font-mono text-accent">{{ c.key === sortKey ? (sortDir === 1 ? "▲" : "▼") : "" }}</span>
          </button>
          <span v-else :class="[heading(), c.align === 'right' && 'justify-end']">{{ c.label }}</span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(row, i) in rows"
        :key="rowKey(row, i)"
        :data-row="rowKey(row, i)"
        class="[&_td]:border-b [&_td]:border-line-soft [&_td]:py-[5px] [&_td]:whitespace-nowrap"
        :class="[
          compact ? '[&_td]:px-2' : '[&_td]:px-3',
          selectable() && 'cursor-pointer',
          rowKey(row, i) === selected ? 'text-ink [&_td]:bg-accent/12' : 'text-soft',
          selectable() && rowKey(row, i) !== selected && 'hover:[&_td]:bg-hover',
          rowClass?.(row),
        ]"
        @click="selectable() && emit('select', rowKey(row, i))"
        @dblclick="selectable() && emit('open', rowKey(row, i))"
      >
        <td v-for="c in columns" :key="c.key" :class="c.align === 'right' && 'text-right'">
          <slot :name="`cell-${c.key}`" :row="row">{{ cell(row, c.key) }}</slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>
