<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Field } from "../../fields.ts";
import type { Marker } from "../../markers.ts";
import { buildTree, pathTo, visibleRows, type TreeNode } from "../../structure.ts";
import { hex } from "../../ui.ts";
import LabAlert from "../LabAlert.vue";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import LabListRow from "../LabListRow.vue";
import LabSection from "../LabSection.vue";

/**
 * The structure of a file as a tree you can fold: its chunks or its header and parts, with their fields. The node
 * holding the selected byte opens and is marked, and clicking a node selects its first byte.
 */
const props = defineProps<{ file: string; markers: Marker[]; fields: Field[]; cursor: number; note?: string }>();
const emit = defineEmits<{ jump: [offset: number] }>();

const tree = computed(() => buildTree(props.markers, props.fields));
const errors = computed(() => props.markers.filter((m) => m.error));
const open = ref(new Set<string>());
const path = computed(() => pathTo(tree.value, props.cursor));
const rows = computed(() => visibleRows(tree.value, open.value, props.cursor));

// Open the way to the selected byte, keeping what else was open, and bring its row into view.
watch(
  path,
  (nodes) => {
    const next = new Set(open.value);
    for (const n of nodes.slice(0, -1)) next.add(n.id);
    open.value = next;
    const last = nodes.at(-1);
    if (last)
      void nextTick(() =>
        document.querySelector(`[data-tree-node="${CSS.escape(last.id)}"]`)?.scrollIntoView({ block: "nearest" }),
      );
  },
  { immediate: true },
);
watch(
  () => props.file,
  () => (open.value = new Set(path.value.slice(0, -1).map((n) => n.id))),
);

/**
 * Clicking an open node that holds the selected byte closes it. Any other click opens the node and selects its first
 * byte, which may be in a field inside it.
 */
function select(node: TreeNode) {
  const next = new Set(open.value);
  if (next.has(node.id) && path.value.includes(node)) next.delete(node.id);
  else {
    if (node.children.length) next.add(node.id);
    emit("jump", node.offset);
  }
  open.value = next;
}

/** Opens every node, except the long lists of fields, like the commands of every frame. */
function expandAll() {
  const ids = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes)
      if (n.children.length && n.children.length <= 100) {
        ids.add(n.id);
        walk(n.children);
      }
  };
  walk(tree.value);
  open.value = ids;
}
const collapseAll = () => (open.value = new Set());
</script>

<template>
  <LabSection title="Structure">
    <template v-if="tree.length" #action>
      <div class="-mr-1.5 flex">
        <LabButton variant="ghost" icon aria-label="Expand all" title="Expand all" @click="expandAll">
          <LabIcon name="expandAll" />
        </LabButton>
        <LabButton variant="ghost" icon aria-label="Collapse all" title="Collapse all" @click="collapseAll">
          <LabIcon name="collapseAll" />
        </LabButton>
      </div>
    </template>
    <LabAlert v-for="(m, i) in errors" :key="`e${i}`" class="my-1">
      <span
        ><span v-if="m.offset !== undefined" class="font-mono text-error">{{ hex(m.offset, 4) }}</span> decoder stopped
        {{ m.offset !== undefined ? "here" : "" }}</span
      >
      <span class="text-muted">{{ m.detail }}</span>
      <template v-if="m.offset !== undefined" #action>
        <LabButton class="h-[22px]! text-2xs!" @click="emit('jump', m.offset ?? 0)">Jump</LabButton>
      </template>
    </LabAlert>
    <ul v-if="tree.length" class="-mx-3 flex flex-col">
      <li v-for="(row, i) in rows" :key="'node' in row ? row.node.id : `more${i}`">
        <LabListRow
          v-if="'node' in row"
          :data-tree-node="row.node.id"
          :name="hex(row.node.offset, 4)"
          name-width="3.25rem"
          :selected="path.at(-1) === row.node"
          :expanded="row.node.children.length ? open.has(row.node.id) : undefined"
          :indent="row.depth"
          inset
          @click="select(row.node)"
        >
          <span
            class="shrink-0 font-mono text-meta font-semibold"
            :class="row.node.field ? 'text-soft' : 'text-partial'"
            >{{ row.node.label }}</span
          >
          <span class="min-w-0 truncate text-meta text-muted" :title="row.node.detail">{{ row.node.detail }}</span>
        </LabListRow>
        <p v-else class="py-1 text-meta text-muted" :style="{ paddingLeft: `${12 + row.depth * 14 + 64}px` }">
          {{ row.more.toLocaleString("en-US") }} more · select a byte there to show it
        </p>
      </li>
    </ul>
    <p v-else-if="!errors.length" class="text-meta text-muted">{{ note ?? "No structure read for this file" }}</p>
  </LabSection>
</template>
