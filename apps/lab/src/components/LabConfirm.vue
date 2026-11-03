<script setup lang="ts">
import { useId, useTemplateRef, watch } from "vue";
import LabButton from "./LabButton.vue";

/** A question that needs a yes before something happens, like removing the loaded files. Opens while `open` is true. */
withDefaults(defineProps<{ title: string; confirmLabel: string; danger?: boolean }>(), { danger: false });
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ confirm: [] }>();

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const id = useId();
watch([open, dialog], ([isOpen, el]) => {
  if (!el) return;
  if (isOpen && !el.open) el.showModal();
  else if (!isOpen && el.open) el.close();
});

function confirm() {
  open.value = false;
  emit("confirm");
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-text`"
    class="m-auto w-[380px] rounded-lg border border-line-strong bg-raised p-0 text-ink shadow-xl backdrop:bg-black/50"
    @close="open = false"
  >
    <div class="flex flex-col gap-3 p-4">
      <h2 :id="`${id}-title`" class="text-heading-sm font-semibold">{{ title }}</h2>
      <p :id="`${id}-text`" class="text-soft"><slot /></p>
      <div class="mt-1 flex justify-end gap-2">
        <LabButton autofocus @click="open = false">Cancel</LabButton>
        <LabButton :variant="danger ? 'danger' : 'primary'" @click="confirm">{{ confirmLabel }}</LabButton>
      </div>
    </div>
  </dialog>
</template>
